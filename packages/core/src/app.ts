import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { AGENTS, type AgentDefinition } from './agents/definitions.js';
import { type AgentEvent } from './agents/runner.js';
import {
  SettingsStore,
  getConfigDir,
  resolveAIConfig,
  type SecretSource,
  type Settings,
} from './config/settings.js';
import type { EngineAdapter, LevelBrief } from './engines/types.js';
import { GameForgeError, toUserError } from './errors.js';
import type { GameForgeEventListener, PipelineStepId, PipelineStepStatus } from './events-types.js';
import { GitService } from './git/git.js';
import { LogHub, fileSink, type Logger } from './logger.js';
import { GrantStore, denyAll, type ConfirmationHandler } from './permissions/permissions.js';
import {
  GAME_PLAN_JSON_SCHEMA,
  extractJson,
  parseGamePlan,
  type GamePlan,
} from './plan/game-plan.js';
import { PluginHost, type GameForgePlugin, type PluginInfo } from './plugins/plugins.js';
import { ProjectSession, type ValidationOutcome } from './project.js';
import { ProviderRegistry } from './providers/registry.js';
import type { AIConfig, AIProvider, ChatMessage } from './providers/types.js';
import { builtinTools } from './tools/builtin.js';
import { ToolRegistry } from './tools/registry.js';
import { Workspace } from './workspace/workspace.js';
import { randomUUID } from 'node:crypto';
import type { TestRunReport } from './engines/types.js';

export interface GameForgeOptions {
  configDir?: string;
  env?: NodeJS.ProcessEnv;
  /** Desktop: decrypted API keys from the OS keychain. */
  secrets?: () => SecretSource;
  confirm?: ConfirmationHandler;
  logHub?: LogHub;
  /** Built-in plugins (e.g. Godot). Always loaded. */
  builtinPlugins?: GameForgePlugin[];
  /** Write a log file to <configDir>/logs (default true). */
  logToFile?: boolean;
}

export interface PlanOptions {
  signal?: AbortSignal;
  onEvent?: GameForgeEventListener;
  /** For "Edit" / "Regenerate": the previous plan and what to change. */
  previous?: GamePlan;
  feedback?: string;
}

export interface CreateGameOptions {
  parentDir: string;
  folderName?: string;
  initGit?: boolean;
  signal?: AbortSignal;
  onEvent?: GameForgeEventListener;
}

export interface CreateGameResult {
  root: string;
  project: ProjectSession;
  files: string[];
  customFeatures: string[];
  validation: ValidationOutcome | null;
  tests: TestRunReport | null;
}

export function slugify(title: string): string {
  return (
    title
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48) || 'my-game'
  );
}

const LevelBriefSchema = z
  .object({
    roomNames: z.array(z.string().min(1).max(40)).max(24).optional(),
    roomNotes: z.array(z.string().min(1).max(120)).max(24).optional(),
    seed: z.number().int().optional(),
  })
  .passthrough();

/**
 * The GameForge application core. Shared by the desktop app, the CLI and the
 * MCP server. Holds settings, registries, plugins and creates project sessions.
 */
export class GameForge {
  readonly settingsStore: SettingsStore;
  readonly configDir: string;
  readonly logHub: LogHub;
  readonly logger: Logger;
  readonly tools = new ToolRegistry();
  readonly providers = new ProviderRegistry();
  readonly plugins: PluginHost;
  readonly grants: GrantStore;
  readonly git = new GitService();
  readonly env: NodeJS.ProcessEnv;
  confirm: ConfirmationHandler;
  private readonly secrets: () => SecretSource;
  private pluginInfos: PluginInfo[] = [];

  private constructor(options: GameForgeOptions) {
    this.configDir = options.configDir ?? getConfigDir(options.env ?? process.env);
    this.env = options.env ?? process.env;
    this.settingsStore = new SettingsStore(this.configDir);
    this.logHub = options.logHub ?? new LogHub((this.env.GAMEFORGE_LOG_LEVEL as 'info') ?? 'info');
    if (options.logToFile !== false) {
      try {
        this.logHub.addSink(fileSink(path.join(this.configDir, 'logs', 'gameforge.log')));
      } catch {
        // Logging to file is best effort.
      }
    }
    this.logger = this.logHub.logger('gameforge');
    this.grants = new GrantStore(path.join(this.configDir, 'permissions.json'));
    this.confirm = options.confirm ?? denyAll;
    this.secrets = options.secrets ?? (() => ({}));
    this.plugins = new PluginHost({ tools: this.tools, providers: this.providers }, this.logger);
    for (const tool of builtinTools()) this.tools.register(tool);
  }

  static async create(options: GameForgeOptions = {}): Promise<GameForge> {
    const app = new GameForge(options);
    for (const plugin of options.builtinPlugins ?? []) {
      app.pluginInfos.push(await app.plugins.load(plugin, { builtin: true }));
    }
    const discovered = PluginHost.discover(app.pluginDir);
    app.pluginInfos.push(
      ...(await app.plugins.loadDiscovered(discovered, app.settings.plugins.enabled)),
    );
    return app;
  }

  get pluginDir(): string {
    return path.join(this.configDir, 'plugins');
  }

  get settings(): Settings {
    return this.settingsStore.load();
  }

  listPlugins(): PluginInfo[] {
    return this.plugins.list(PluginHost.discover(this.pluginDir));
  }

  aiConfig(): AIConfig {
    return resolveAIConfig(this.settings, this.env, this.secrets());
  }

  /** Creates the configured AI provider (throws a helpful error when unconfigured). */
  createProvider(): AIProvider {
    return this.providers.create(this.aiConfig());
  }

  agents(): AgentDefinition[] {
    return [...Object.values(AGENTS), ...this.plugins.agents.values()];
  }

  engines(): EngineAdapter[] {
    return [...this.plugins.engines.values()];
  }

  engine(id = 'godot'): EngineAdapter {
    const engine = this.plugins.engines.get(id);
    if (!engine) {
      throw new GameForgeError('ENGINE_NOT_SUPPORTED', `Engine "${id}" is not available.`, {
        solution: 'Make sure the engine plugin is installed and enabled.',
      });
    }
    return engine;
  }

  async detectEngine(root: string): Promise<EngineAdapter | null> {
    for (const engine of this.engines()) {
      if (await engine.isProject(root)) return engine;
    }
    return null;
  }

  async openProject(root: string): Promise<ProjectSession> {
    const workspace = Workspace.open(root, { policy: 'agent' });
    const engine = await this.detectEngine(workspace.root);
    this.settingsStore.addRecentProject(workspace.root);
    return new ProjectSession(this, workspace, engine);
  }

  // ------------------------------------------------------------ planning

  /** Game Designer: turns a description into a validated Game Plan. */
  async generatePlan(description: string, options: PlanOptions = {}): Promise<GamePlan> {
    const text = description.trim();
    if (text.length < 3) {
      throw new GameForgeError('INVALID_INPUT', 'Describe your game idea first.', {
        solution:
          'For example: "A 3D horror game in an abandoned hospital where you find keys and escape a monster."',
      });
    }
    const provider = this.createProvider();
    const designer = AGENTS['game-designer'];
    const runId = randomUUID();
    const emit = (event: AgentEvent) => options.onEvent?.(event);
    emit({
      type: 'agent:start',
      runId,
      agent: designer.id,
      agentName: designer.name,
      task: `Plan: ${text.slice(0, 200)}`,
    });

    const instructions = [
      'Create the game plan for this idea.',
      `<description>${text}</description>`,
      options.previous
        ? `Here is the previous plan. Apply the user's requested changes and keep everything else:\n<previous_plan>${JSON.stringify(options.previous)}</previous_plan>`
        : '',
      options.feedback ? `<requested_changes>${options.feedback}</requested_changes>` : '',
      'Respond with a single JSON object that matches the game plan schema. No prose.',
    ]
      .filter(Boolean)
      .join('\n\n');

    const messages: ChatMessage[] = [{ role: 'user', content: instructions }];
    const usage = { inputTokens: 0, outputTokens: 0 };
    let lastError: GameForgeError | null = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const response = await provider.chat({
          system: designer.systemPrompt,
          messages,
          responseSchema: { name: 'game_plan', schema: GAME_PLAN_JSON_SCHEMA },
          purpose: 'game-plan',
          maxTokens: 16000,
          ...(options.signal ? { signal: options.signal } : {}),
        });
        usage.inputTokens += response.usage?.inputTokens ?? 0;
        usage.outputTokens += response.usage?.outputTokens ?? 0;
        if (response.stopReason === 'refusal') {
          throw new GameForgeError(
            'PROVIDER_REQUEST_FAILED',
            'The AI model declined to plan this game.',
            {
              solution: 'Rephrase the description and try again.',
            },
          );
        }
        messages.push({
          role: 'assistant',
          content: response.text,
          ...(response.providerData ? { providerData: response.providerData } : {}),
        });
        try {
          const plan = parseGamePlan(extractJson(response.text));
          emit({
            type: 'agent:end',
            runId,
            agent: designer.id,
            status: 'done',
            summary: `Planned "${plan.title}" with ${plan.features.length} features.`,
            usage,
          });
          return plan;
        } catch (error) {
          lastError =
            error instanceof GameForgeError
              ? error
              : new GameForgeError('PLAN_INVALID', 'Invalid plan.');
          this.logger.warn(
            `Plan attempt ${attempt + 1} invalid`,
            lastError.reason ?? lastError.message,
          );
          messages.push({
            role: 'user',
            content: `That plan was not valid: ${lastError.reason ?? lastError.message}. Return the corrected JSON object only.`,
          });
        }
      } catch (error) {
        const userError = toUserError(error);
        emit({
          type: 'agent:end',
          runId,
          agent: designer.id,
          status: userError.code === 'CANCELLED' ? 'cancelled' : 'failed',
          summary: userError.message,
          error: userError,
          usage,
        });
        throw error;
      }
    }
    const failure = new GameForgeError(
      'PLAN_INVALID',
      'The AI could not produce a valid game plan.',
      {
        reason: lastError?.reason ?? 'The response did not match the plan format.',
        solution: 'Try again, simplify the description, or use a more capable model.',
      },
    );
    emit({
      type: 'agent:end',
      runId,
      agent: designer.id,
      status: 'failed',
      summary: failure.message,
      error: failure.toJSON(),
      usage,
    });
    throw failure;
  }

  // ------------------------------------------------------------ creation

  /** Runs the full generation pipeline for an approved plan. */
  async createGame(plan: GamePlan, options: CreateGameOptions): Promise<CreateGameResult> {
    const validPlan = parseGamePlan(plan);
    const engine = this.engine(validPlan.engine);
    const parent = path.resolve(options.parentDir);
    const folder = options.folderName?.trim()
      ? slugify(options.folderName)
      : slugify(validPlan.title);
    const root = path.join(parent, folder);
    if (existsSync(root) && readdirSync(root).length > 0) {
      throw new GameForgeError(
        'FILE_EXISTS',
        `The folder "${folder}" already exists and is not empty.`,
        {
          solution: 'Choose another location or project name.',
        },
      );
    }
    mkdirSync(root, { recursive: true });
    const emit = options.onEvent ?? (() => {});
    const step = (
      stepId: PipelineStepId,
      label: string,
      agent: string,
      status: PipelineStepStatus,
      detail?: string,
    ) =>
      emit({
        type: 'pipeline:step',
        step: stepId,
        label,
        agent,
        status,
        ...(detail ? { detail } : {}),
      });
    const provider = this.createProvider();

    // 1. Level brief (Level Designer)
    step('level', 'Design level layout', 'Level Designer', 'running');
    let levelBrief: LevelBrief = {};
    if (provider.capabilities.generative) {
      try {
        const response = await provider.chat({
          system: AGENTS['level-designer'].systemPrompt,
          messages: [
            {
              role: 'user',
              content: `Game plan:\n${JSON.stringify(validPlan)}\n\nName the ${validPlan.level.rooms} rooms of "${validPlan.level.name}" (first = start room, last = exit room) and write one short in-world sign or note per room. Respond with JSON only: {"roomNames": string[], "roomNotes": string[]}`,
            },
          ],
          responseSchema: {
            name: 'level_brief',
            schema: {
              type: 'object',
              additionalProperties: false,
              required: ['roomNames', 'roomNotes'],
              properties: {
                roomNames: { type: 'array', items: { type: 'string' } },
                roomNotes: { type: 'array', items: { type: 'string' } },
              },
            },
          },
          purpose: 'level-brief',
          maxTokens: 8000,
          ...(options.signal ? { signal: options.signal } : {}),
        });
        levelBrief = LevelBriefSchema.parse(extractJson(response.text)) as LevelBrief;
        step(
          'level',
          'Design level layout',
          'Level Designer',
          'done',
          `${levelBrief.roomNames?.length ?? 0} rooms named by AI`,
        );
      } catch (error) {
        const userError = toUserError(error);
        if (userError.code === 'CANCELLED') throw error;
        this.logger.warn('Level brief failed, using template defaults', error);
        step(
          'level',
          'Design level layout',
          'Level Designer',
          'done',
          `AI brief failed (${userError.reason ?? userError.message}); using template layout`,
        );
      }
    } else {
      step(
        'level',
        'Design level layout',
        'Level Designer',
        'done',
        'Template layout (no generative AI configured)',
      );
    }

    // 2. Scaffold, assets, audio (engine generator, deterministic templates)
    const writer = Workspace.open(root, { policy: 'user' });
    const labels = {
      scaffold: ['Create project, scenes and scripts', 'Programmer'],
      assets: ['Create placeholder assets', 'Asset Manager'],
      audio: ['Create sound events and placeholder audio', 'Audio Designer'],
    } as const;
    const generated = await engine.generate(validPlan, writer, {
      levelBrief,
      logger: this.logger,
      ...(options.signal ? { signal: options.signal } : {}),
      onFile: (file) => emit({ type: 'pipeline:file', path: file }),
      onPhase: (phase, status, files) =>
        step(
          phase,
          labels[phase][0],
          labels[phase][1],
          status,
          status === 'done' ? `${files.length} files` : undefined,
        ),
    });

    // 3. Git (initial commit of the template project, so AI changes stay reviewable)
    if (options.initGit !== false) {
      step('git', 'Initialize git repository', 'Project Manager', 'running');
      try {
        if (!this.git.isAvailable()) {
          step(
            'git',
            'Initialize git repository',
            'Project Manager',
            'skipped',
            'Git is not installed',
          );
        } else {
          await this.git.init(root);
          try {
            const hash = await this.git.commit(
              root,
              `Initial ${engine.displayName} project generated by XyoLua GameForge`,
            );
            step(
              'git',
              'Initialize git repository',
              'Project Manager',
              'done',
              `Initial commit ${hash}`,
            );
          } catch (error) {
            const userError = toUserError(error);
            step(
              'git',
              'Initialize git repository',
              'Project Manager',
              'done',
              `Repository created; initial commit skipped: ${userError.reason ?? userError.message}`,
            );
          }
        }
      } catch (error) {
        step(
          'git',
          'Initialize git repository',
          'Project Manager',
          'failed',
          toUserError(error).message,
        );
      }
    }

    const project = await this.openProject(root);
    const result: CreateGameResult = {
      root: project.root,
      project,
      files: generated.files,
      customFeatures: generated.customFeatures,
      validation: null,
      tests: null,
    };

    // 4. Custom features (Programmer agent)
    const customFeatures = validPlan.features.filter((f) =>
      generated.customFeatures.includes(f.id),
    );
    if (customFeatures.length === 0) {
      step(
        'code',
        'Implement custom features',
        'Programmer',
        'skipped',
        'All features are covered by tested templates',
      );
    } else if (!provider.capabilities.generative) {
      step(
        'code',
        'Implement custom features',
        'Programmer',
        'skipped',
        `Needs a generative AI provider: ${customFeatures.map((f) => f.name).join(', ')}`,
      );
    } else {
      step('code', 'Implement custom features', 'Programmer', 'running');
      const task = [
        `Implement these features in the generated ${engine.displayName} project. The plan is in .gameforge/plan.json; read the existing scripts first and integrate with them (autoloads, data/game_config.json).`,
        ...customFeatures.map((f) => `- ${f.name} (${f.id}): ${f.description}`),
        'Keep the game runnable at every step. Add a short note per feature to README.md under "Custom features".',
      ].join('\n');
      const run = await project.runAgent('programmer', task, {
        mode: 'direct',
        ...(options.signal ? { signal: options.signal } : {}),
        onEvent: emit,
      });
      step(
        'code',
        'Implement custom features',
        'Programmer',
        run.status === 'done' ? 'done' : 'failed',
        run.summary.slice(0, 300),
      );
    }

    // 5. QA: validate with the engine + run generated tests
    result.validation = await project.validateWithFixes({
      ...(options.signal ? { signal: options.signal } : {}),
      onEvent: emit,
      allowAiFixes: provider.capabilities.generative,
    });
    if (result.validation.engineAvailable) {
      step('tests', 'Run tests', 'QA', 'running');
      try {
        result.tests = await project.runTests({
          asAgent: true,
          ...(options.signal ? { signal: options.signal } : {}),
          onEvent: emit,
        });
        step(
          'tests',
          'Run tests',
          'QA',
          result.tests.ok ? 'done' : 'failed',
          `${result.tests.passed}/${result.tests.total} passed`,
        );
      } catch (error) {
        const userError = toUserError(error);
        step(
          'tests',
          'Run tests',
          'QA',
          userError.code === 'PERMISSION_DENIED' ? 'skipped' : 'failed',
          userError.reason ?? userError.message,
        );
      }
    } else {
      step(
        'tests',
        'Run tests',
        'QA',
        'skipped',
        'Godot not detected — install Godot 4 or set its path in Settings to run tests',
      );
    }
    return result;
  }
}
