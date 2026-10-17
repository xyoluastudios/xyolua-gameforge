import path from 'node:path';
import { createInterface } from 'node:readline';
import type { Readable, Writable } from 'node:stream';
import { z } from 'zod';
import {
  GameForgeError,
  parseGamePlan,
  slugify,
  toJsonSchema,
  toUserError,
  type GameForge,
  type ProjectSession,
  type ToolDefinition,
} from '@gameforge/core';

/**
 * Optional MCP (Model Context Protocol) server for GameForge.
 *
 * Lets MCP clients such as Claude Desktop or Claude Code use GameForge's
 * sandboxed tools on a project:  Claude → MCP → GameForge → Game project.
 * Transport: newline-delimited JSON-RPC 2.0 over stdio.
 */

export const SUPPORTED_PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'];
export const SERVER_VERSION = '0.1.0';

type JsonRpcId = string | number | null;

interface JsonRpcRequest {
  jsonrpc: '2.0';
  id?: JsonRpcId;
  method: string;
  params?: Record<string, unknown>;
}

export interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: JsonRpcId;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

export interface McpServerOptions {
  app: GameForge;
  /** The project the tools operate on (optional for create_game_project only). */
  projectRoot?: string;
  /** Folder in which create_game_project may create new projects. */
  createRoot?: string;
  /** Allow tools that write files or execute the engine. */
  allowWrite: boolean;
}

interface McpTool {
  name: string;
  description: string;
  input: z.ZodType;
  write: boolean;
  run(input: unknown): Promise<{ text: string; data?: unknown; isError?: boolean }>;
}

export class McpServer {
  private project: ProjectSession | null = null;
  private initialized = false;
  private readonly tools: McpTool[];

  constructor(private readonly options: McpServerOptions) {
    this.tools = this.buildTools();
  }

  private async requireProject(): Promise<ProjectSession> {
    if (!this.options.projectRoot) {
      throw new GameForgeError('PROJECT_NOT_FOUND', 'No project configured.', {
        solution: 'Start the server with --project <path-to-game>.',
      });
    }
    if (!this.project) {
      this.project = await this.options.app.openProject(this.options.projectRoot);
      // Direct mode: MCP clients have no review UI in GameForge; git shows the diff.
      if (!this.project.workspace.changes) this.project.workspace.beginChanges('direct');
    }
    return this.project;
  }

  /** Wraps a core tool so it runs inside the project sandbox with the MCP actor. */
  private coreTool(name: string, write: boolean): McpTool | null {
    const tool = this.options.app.tools.get(name) as ToolDefinition | undefined;
    if (!tool) return null;
    return {
      name,
      description: tool.description,
      input: tool.input,
      write,
      run: async (input) => {
        const project = await this.requireProject();
        const result = await this.options.app.tools.execute(name, input, {
          ...project.toolContext(),
          actor: 'MCP client',
        });
        return {
          text: result.output,
          ...(result.data === undefined ? {} : { data: result.data }),
          ...(result.ok ? {} : { isError: true }),
        };
      },
    };
  }

  private buildTools(): McpTool[] {
    const tools: McpTool[] = [];
    for (const [name, write] of [
      ['list_files', false],
      ['read_file', false],
      ['search_code', false],
      ['analyze_project', false],
      ['git_status', false],
      ['git_diff', false],
      ['write_file', true],
      ['edit_file', true],
      ['create_directory', true],
    ] as const) {
      const tool = this.coreTool(name, write);
      if (tool) tools.push(tool);
    }
    tools.push({
      name: 'project_info',
      description:
        'Describe the open game project: engine, name, main scene and whether the engine is installed.',
      input: z.object({}),
      write: false,
      run: async () => {
        const project = await this.requireProject();
        const install = await project.engine?.detectInstallation();
        const info = {
          root: project.root,
          engine: project.engine?.displayName ?? 'unknown',
          engineInstalled: install ? `${install.version} (${install.executable})` : 'not detected',
          writeAccess: this.options.allowWrite,
        };
        return { text: JSON.stringify(info, null, 2), data: info };
      },
    });
    tools.push({
      name: 'run_tests',
      description: 'Run the project tests headless in the game engine (executes project code).',
      input: z.object({}),
      write: true,
      run: async () => {
        const project = await this.requireProject();
        const report = await project.runTests();
        const failed = report.results
          .filter((r) => r.status === 'failed')
          .map((r) => `✗ ${r.name}: ${r.message ?? ''}`);
        return {
          text: [
            `${report.ok ? 'PASSED' : 'FAILED'} ${report.passed}/${report.total}`,
            ...failed,
            report.error ? `${report.error.message} ${report.error.reason ?? ''}` : '',
          ]
            .filter(Boolean)
            .join('\n'),
          data: report,
          ...(report.ok ? {} : { isError: true }),
        };
      },
    });
    tools.push({
      name: 'validate_project',
      description:
        'Load all scripts and scenes in the engine and run the game scene headless; returns engine errors (executes project code).',
      input: z.object({}),
      write: true,
      run: async () => {
        const project = await this.requireProject();
        const result = await project.validate();
        const lines = result.errors.map(
          (e) => `${e.file ?? ''}${e.line ? `:${e.line}` : ''} ${e.message}`,
        );
        return {
          text: !result.engineAvailable
            ? 'Engine not installed — cannot validate.'
            : result.ok
              ? 'No errors.'
              : lines.join('\n'),
          data: result,
          ...(result.ok ? {} : { isError: true }),
        };
      },
    });
    tools.push({
      name: 'create_game_project',
      description:
        'Create a new, runnable Godot project from a GameForge game plan (JSON). The plan fields: title, genre, engine "godot", dimension "2d"|"3d", perspective "first-person"|"top-down", summary, setting, artStyle, coreLoop[], features[{id,name,description,priority}], player{moveSpeed,sprintSpeed,maxHealth}, enemies[{name,behavior,speed,damage,count}], level{name,theme,rooms,keys}, audio{ambience,music,events[]}, multiplayer{enabled,maxPlayers}, notes[].',
      input: z.object({
        plan: z.record(z.string(), z.unknown()),
        folder_name: z.string().optional(),
      }),
      write: true,
      run: async (input) => {
        const { plan: rawPlan, folder_name } = input as { plan: unknown; folder_name?: string };
        const createRoot =
          this.options.createRoot ??
          (this.options.projectRoot ? path.dirname(this.options.projectRoot) : process.cwd());
        const plan = parseGamePlan(rawPlan);
        const result = await this.options.app.createGame(plan, {
          parentDir: createRoot,
          folderName: folder_name ?? slugify(plan.title),
          initGit: true,
        });
        return {
          text: `Created ${result.files.length} files in ${result.root}.${result.customFeatures.length ? ` Custom features to implement: ${result.customFeatures.join(', ')}.` : ''}`,
          data: {
            root: result.root,
            files: result.files.length,
            customFeatures: result.customFeatures,
          },
        };
      },
    });
    return tools;
  }

  private visibleTools(): McpTool[] {
    return this.tools.filter((t) => this.options.allowWrite || !t.write);
  }

  /** Handles one JSON-RPC message. Returns null for notifications. */
  async handle(message: unknown): Promise<JsonRpcResponse | null> {
    const request = message as JsonRpcRequest;
    const id = request?.id ?? null;
    const isNotification = request?.id === undefined;
    const error = (code: number, msg: string, data?: unknown): JsonRpcResponse => ({
      jsonrpc: '2.0',
      id,
      error: { code, message: msg, ...(data === undefined ? {} : { data }) },
    });
    if (!request || request.jsonrpc !== '2.0' || typeof request.method !== 'string') {
      return isNotification ? null : error(-32600, 'Invalid Request');
    }
    try {
      switch (request.method) {
        case 'initialize': {
          const requested = String(request.params?.protocolVersion ?? '');
          this.initialized = true;
          return {
            jsonrpc: '2.0',
            id,
            result: {
              protocolVersion: SUPPORTED_PROTOCOL_VERSIONS.includes(requested)
                ? requested
                : SUPPORTED_PROTOCOL_VERSIONS[0],
              capabilities: { tools: { listChanged: false } },
              serverInfo: {
                name: 'xyolua-gameforge',
                title: 'XyoLua GameForge',
                version: SERVER_VERSION,
              },
              instructions:
                'GameForge tools operate inside one sandboxed game project. Secret files are never readable. ' +
                (this.options.allowWrite
                  ? 'Write and engine tools are enabled.'
                  : 'The server is read-only; write tools are disabled.'),
            },
          };
        }
        case 'notifications/initialized':
        case 'notifications/cancelled':
          return null;
        case 'ping':
          return { jsonrpc: '2.0', id, result: {} };
        case 'tools/list':
          return {
            jsonrpc: '2.0',
            id,
            result: {
              tools: this.visibleTools().map((tool) => ({
                name: tool.name,
                description: tool.description,
                inputSchema: toJsonSchema(tool.input),
              })),
            },
          };
        case 'tools/call': {
          if (!this.initialized) return error(-32002, 'Server not initialized');
          const name = String(request.params?.name ?? '');
          const tool = this.visibleTools().find((t) => t.name === name);
          if (!tool) {
            const hidden = this.tools.some((t) => t.name === name);
            return error(
              -32602,
              hidden
                ? `Tool "${name}" requires write access (start with --allow-write or enable mcp.allowWrite).`
                : `Unknown tool: ${name}`,
            );
          }
          const args = request.params?.arguments ?? {};
          const parsed = tool.input.safeParse(args);
          if (!parsed.success) {
            return {
              jsonrpc: '2.0',
              id,
              result: {
                content: [
                  {
                    type: 'text',
                    text: `Invalid arguments: ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`,
                  },
                ],
                isError: true,
              },
            };
          }
          try {
            const output = await tool.run(parsed.data);
            return {
              jsonrpc: '2.0',
              id,
              result: {
                content: [{ type: 'text', text: output.text }],
                ...(output.isError ? { isError: true } : {}),
              },
            };
          } catch (toolError) {
            const userError = toUserError(toolError);
            return {
              jsonrpc: '2.0',
              id,
              result: {
                content: [
                  {
                    type: 'text',
                    text: [userError.message, userError.reason, userError.solution]
                      .filter(Boolean)
                      .join('\n'),
                  },
                ],
                isError: true,
              },
            };
          }
        }
        default:
          return isNotification ? null : error(-32601, `Method not found: ${request.method}`);
      }
    } catch (failure) {
      const userError = toUserError(failure);
      return isNotification ? null : error(-32603, userError.message, userError);
    }
  }

  /** Serves newline-delimited JSON-RPC over the given streams (stdio by default). */
  serve(input: Readable = process.stdin, output: Writable = process.stdout): Promise<void> {
    const lines = createInterface({ input, crlfDelay: Infinity });
    const send = (response: JsonRpcResponse) => output.write(`${JSON.stringify(response)}\n`);
    lines.on('line', (line) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      let message: unknown;
      try {
        message = JSON.parse(trimmed);
      } catch {
        send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } });
        return;
      }
      const batch = Array.isArray(message) ? message : [message];
      for (const item of batch) {
        void this.handle(item).then((response) => {
          if (response) send(response);
        });
      }
    });
    return new Promise((resolve) => lines.on('close', () => resolve()));
  }
}
