import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { AgentDefinition } from '../agents/definitions.js';
import type { EngineAdapter } from '../engines/types.js';
import { GameForgeError, toUserError } from '../errors.js';
import type { Logger } from '../logger.js';
import type { ProviderFactory, ProviderRegistry } from '../providers/registry.js';
import type { ToolRegistry } from '../tools/registry.js';
import type { ToolDefinition } from '../tools/types.js';

/** Version of the public plugin API. Bumped on breaking changes. */
export const PLUGIN_API_VERSION = 1;

export interface PluginContext {
  readonly apiVersion: number;
  readonly logger: Logger;
  /** Adds a game engine (Godot, Unity, Unreal, Roblox, ...). */
  registerEngine(adapter: EngineAdapter): void;
  /** Adds an agent tool (validated, permission-checked like built-ins). */
  registerTool(tool: ToolDefinition): void;
  /** Adds an AI provider (AIProviderPlugin). */
  registerProvider(factory: ProviderFactory): void;
  /** Adds an agent role the orchestrator can delegate to. */
  registerAgent(agent: AgentDefinition): void;
}

export interface GameForgePlugin {
  /** Unique, kebab-case id, e.g. "godot" or "acme-unity". */
  id: string;
  name: string;
  version: string;
  /** Plugin API version this plugin was written for. */
  apiVersion: number;
  description?: string;
  activate(context: PluginContext): void | Promise<void>;
  deactivate?(): void | Promise<void>;
}

/** Identity helper for plugin authors (gives type checking). */
export function definePlugin(plugin: GameForgePlugin): GameForgePlugin {
  return plugin;
}

export interface PluginInfo {
  id: string;
  name: string;
  version: string;
  description?: string;
  builtin: boolean;
  status: 'active' | 'disabled' | 'failed';
  error?: string;
  path?: string;
  contributes: { engines: string[]; tools: string[]; providers: string[]; agents: string[] };
}

export interface DiscoveredPlugin {
  id: string;
  name: string;
  version: string;
  description?: string;
  dir: string;
  entry: string;
}

interface PluginManifest {
  name?: string;
  version?: string;
  description?: string;
  main?: string;
  gameforge?: { id?: string; displayName?: string; entry?: string };
}

/**
 * Loads plugins and wires their contributions into the registries.
 *
 * Third-party plugins are regular Node packages in `<config>/plugins/<name>`
 * with a `gameforge` field in package.json. They run with full Node.js
 * privileges, so they are only loaded when the user enabled them explicitly.
 */
export class PluginHost {
  readonly engines = new Map<string, EngineAdapter>();
  readonly agents = new Map<string, AgentDefinition>();
  private readonly loaded = new Map<string, { plugin: GameForgePlugin; info: PluginInfo }>();
  private readonly failed: PluginInfo[] = [];

  constructor(
    private readonly registries: { tools: ToolRegistry; providers: ProviderRegistry },
    private readonly logger: Logger,
  ) {}

  async load(
    plugin: GameForgePlugin,
    options: { builtin?: boolean; path?: string } = {},
  ): Promise<PluginInfo> {
    const contributes: PluginInfo['contributes'] = {
      engines: [],
      tools: [],
      providers: [],
      agents: [],
    };
    const base = {
      id: String(plugin?.id ?? 'unknown'),
      name: String(plugin?.name ?? plugin?.id ?? 'unknown'),
      version: String(plugin?.version ?? '0.0.0'),
      builtin: options.builtin ?? false,
      contributes,
      ...(plugin?.description ? { description: plugin.description } : {}),
      ...(options.path ? { path: options.path } : {}),
    };
    try {
      if (
        !plugin ||
        typeof plugin.activate !== 'function' ||
        !/^[a-z0-9][a-z0-9-]*$/.test(plugin.id)
      ) {
        throw new GameForgeError('PLUGIN_FAILED', 'Not a valid GameForge plugin.', {
          reason:
            'A plugin must export { id (kebab-case), name, version, apiVersion, activate() }.',
        });
      }
      if (plugin.apiVersion !== PLUGIN_API_VERSION) {
        throw new GameForgeError(
          'PLUGIN_FAILED',
          `Plugin "${plugin.id}" targets plugin API ${plugin.apiVersion}.`,
          {
            reason: `This GameForge version provides plugin API ${PLUGIN_API_VERSION}.`,
          },
        );
      }
      if (this.loaded.has(plugin.id)) {
        throw new GameForgeError('PLUGIN_FAILED', `Plugin "${plugin.id}" is already loaded.`);
      }
      const log = this.logger.child(`plugin:${plugin.id}`);
      const context: PluginContext = {
        apiVersion: PLUGIN_API_VERSION,
        logger: log,
        registerEngine: (adapter) => {
          if (this.engines.has(adapter.id))
            throw new GameForgeError('PLUGIN_FAILED', `Engine "${adapter.id}" already registered.`);
          this.engines.set(adapter.id, adapter);
          contributes.engines.push(adapter.id);
        },
        registerTool: (tool) => {
          this.registries.tools.register(tool);
          contributes.tools.push(tool.name);
        },
        registerProvider: (factory) => {
          this.registries.providers.register(factory);
          contributes.providers.push(factory.id);
        },
        registerAgent: (agent) => {
          if (this.agents.has(agent.id))
            throw new GameForgeError('PLUGIN_FAILED', `Agent "${agent.id}" already registered.`);
          this.agents.set(agent.id, agent);
          contributes.agents.push(agent.id);
        },
      };
      await plugin.activate(context);
      const info: PluginInfo = { ...base, status: 'active' };
      this.loaded.set(plugin.id, { plugin, info });
      log.info(`Activated ${plugin.name} ${plugin.version}`);
      return info;
    } catch (error) {
      const userError = toUserError(error);
      this.logger.error(`Plugin "${base.id}" failed to load`, error);
      const info: PluginInfo = {
        ...base,
        status: 'failed',
        error: [userError.message, userError.reason].filter(Boolean).join(' '),
      };
      this.failed.push(info);
      return info;
    }
  }

  /** Finds third-party plugins in a directory (does not execute them). */
  static discover(dir: string): DiscoveredPlugin[] {
    if (!existsSync(dir)) return [];
    const result: DiscoveredPlugin[] = [];
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const pluginDir = path.join(dir, entry.name);
      const manifestPath = path.join(pluginDir, 'package.json');
      if (!existsSync(manifestPath)) continue;
      try {
        const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as PluginManifest;
        if (!manifest.gameforge) continue;
        const entryFile = path.resolve(
          pluginDir,
          manifest.gameforge.entry ?? manifest.main ?? 'index.js',
        );
        if (!entryFile.startsWith(path.resolve(pluginDir))) continue; // entry must stay inside the plugin
        result.push({
          id: manifest.gameforge.id ?? manifest.name ?? entry.name,
          name: manifest.gameforge.displayName ?? manifest.name ?? entry.name,
          version: manifest.version ?? '0.0.0',
          ...(manifest.description ? { description: manifest.description } : {}),
          dir: pluginDir,
          entry: entryFile,
        });
      } catch {
        // Ignore broken manifests during discovery.
      }
    }
    return result;
  }

  /** Imports and activates discovered plugins whose ids are in `enabled`. */
  async loadDiscovered(discovered: DiscoveredPlugin[], enabled: string[]): Promise<PluginInfo[]> {
    const infos: PluginInfo[] = [];
    for (const candidate of discovered) {
      if (!enabled.includes(candidate.id)) continue;
      try {
        const mod = (await import(pathToFileURL(candidate.entry).href)) as {
          default?: GameForgePlugin;
          plugin?: GameForgePlugin;
        };
        infos.push(
          await this.load(mod.default ?? mod.plugin ?? (mod as unknown as GameForgePlugin), {
            path: candidate.dir,
          }),
        );
      } catch (error) {
        this.logger.error(`Could not import plugin ${candidate.id}`, error);
        const info: PluginInfo = {
          id: candidate.id,
          name: candidate.name,
          version: candidate.version,
          builtin: false,
          status: 'failed',
          error: error instanceof Error ? error.message : String(error),
          path: candidate.dir,
          contributes: { engines: [], tools: [], providers: [], agents: [] },
        };
        this.failed.push(info);
        infos.push(info);
      }
    }
    return infos;
  }

  list(discovered: DiscoveredPlugin[] = []): PluginInfo[] {
    const infos = [...[...this.loaded.values()].map((l) => l.info), ...this.failed];
    for (const candidate of discovered) {
      if (infos.some((i) => i.id === candidate.id)) continue;
      infos.push({
        id: candidate.id,
        name: candidate.name,
        version: candidate.version,
        ...(candidate.description ? { description: candidate.description } : {}),
        builtin: false,
        status: 'disabled',
        path: candidate.dir,
        contributes: { engines: [], tools: [], providers: [], agents: [] },
      });
    }
    return infos;
  }

  async deactivateAll(): Promise<void> {
    for (const { plugin } of this.loaded.values()) {
      try {
        await plugin.deactivate?.();
      } catch (error) {
        this.logger.warn(`Plugin ${plugin.id} failed to deactivate`, error);
      }
    }
  }
}
