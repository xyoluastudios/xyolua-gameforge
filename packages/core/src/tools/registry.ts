import { z } from 'zod';
import { GameForgeError, toUserError } from '../errors.js';
import type { JsonSchema, ToolSpec } from '../providers/types.js';
import { redactSecrets } from '../secrets.js';
import type { ToolContext, ToolDefinition, ToolResult } from './types.js';

/** Max characters of tool output handed back to a model. */
export const MAX_TOOL_OUTPUT = 30_000;

export function truncateOutput(text: string, max = MAX_TOOL_OUTPUT): string {
  if (text.length <= max) return text;
  const head = text.slice(0, Math.floor(max * 0.7));
  const tail = text.slice(-Math.floor(max * 0.2));
  return `${head}\n\n[… ${text.length - head.length - tail.length} characters truncated …]\n\n${tail}`;
}

export function toJsonSchema(schema: z.ZodType): JsonSchema {
  // Plugins may pass any object with safeParse(); only zod schemas can be converted.
  if (!(schema as { _zod?: unknown })._zod) return { type: 'object' };
  const json = z.toJSONSchema(schema, {
    target: 'draft-2020-12',
    io: 'input',
    unrepresentable: 'any',
  }) as JsonSchema;
  delete json.$schema;
  return json;
}

export interface ToolEvent {
  phase: 'start' | 'end';
  tool: string;
  actor: string;
  input: unknown;
  result?: ToolResult;
}

/**
 * Holds all tools and is the only way agents execute them. Every call is
 * validated against the tool's schema, logged, permission-checked by the tool
 * and its output is truncated and scrubbed of secrets.
 */
export class ToolRegistry {
  private readonly tools = new Map<string, ToolDefinition>();
  private readonly listeners = new Set<(event: ToolEvent) => void>();

  register(tool: ToolDefinition): void {
    if (!/^[a-z][a-z0-9_]{1,63}$/.test(tool.name)) {
      throw new GameForgeError('PLUGIN_FAILED', `Invalid tool name "${tool.name}".`);
    }
    if (this.tools.has(tool.name)) {
      throw new GameForgeError('PLUGIN_FAILED', `Tool "${tool.name}" is already registered.`);
    }
    this.tools.set(tool.name, tool);
  }

  has(name: string): boolean {
    return this.tools.has(name);
  }

  get(name: string): ToolDefinition | undefined {
    return this.tools.get(name);
  }

  names(): string[] {
    return [...this.tools.keys()];
  }

  list(names?: string[]): ToolDefinition[] {
    if (!names) return [...this.tools.values()];
    return names.map((n) => this.tools.get(n)).filter((t): t is ToolDefinition => !!t);
  }

  specs(names?: string[]): ToolSpec[] {
    return this.list(names).map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema ?? toJsonSchema(tool.input),
    }));
  }

  onEvent(listener: (event: ToolEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Executes a tool. Never throws — failures become error results for the model. */
  async execute(name: string, rawInput: unknown, context: ToolContext): Promise<ToolResult> {
    const started = Date.now();
    const tool = this.tools.get(name);
    const emit = (event: ToolEvent) => {
      for (const listener of this.listeners) {
        try {
          listener(event);
        } catch {
          // ignore listener errors
        }
      }
    };
    if (!tool) {
      const error = new GameForgeError('UNKNOWN_TOOL', `Unknown tool "${name}".`, {
        reason: `Available tools: ${this.names().join(', ')}`,
      });
      return {
        tool: name,
        ok: false,
        output: `${error.message} ${error.reason}`,
        error: error.toJSON(),
        durationMs: 0,
      };
    }
    emit({ phase: 'start', tool: name, actor: context.actor, input: rawInput });
    const log = context.logger.child(`tool:${name}`);
    let result: ToolResult;
    const parsed = tool.input.safeParse(rawInput);
    if (!parsed.success) {
      const issues = parsed.error.issues
        .map((i) => `${i.path.join('.') || 'input'}: ${i.message}`)
        .join('; ');
      result = {
        tool: name,
        ok: false,
        output: `Invalid input for ${name}: ${issues}`,
        error: { code: 'INVALID_INPUT', message: `Invalid input for ${name}`, reason: issues },
        durationMs: Date.now() - started,
      };
    } else {
      try {
        if (context.signal?.aborted) throw new GameForgeError('CANCELLED', 'Cancelled.');
        const output = await tool.run(parsed.data, context);
        result = {
          tool: name,
          ok: true,
          output: truncateOutput(redactSecrets(output.output)),
          ...(output.data === undefined ? {} : { data: output.data }),
          durationMs: Date.now() - started,
        };
      } catch (error) {
        const userError = toUserError(error);
        if (!(error instanceof GameForgeError)) log.error(`Tool ${name} crashed`, error);
        result = {
          tool: name,
          ok: false,
          output: redactSecrets(
            [userError.message, userError.reason, userError.solution].filter(Boolean).join(' '),
          ),
          error: userError,
          durationMs: Date.now() - started,
        };
      }
    }
    log.info(
      `${context.actor} → ${name} ${result.ok ? 'ok' : 'failed'} (${result.durationMs} ms)`,
      result.ok ? undefined : result.output,
    );
    emit({ phase: 'end', tool: name, actor: context.actor, input: rawInput, result });
    return result;
  }
}
