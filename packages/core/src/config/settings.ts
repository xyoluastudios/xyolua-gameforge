import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseEnv } from 'node:util';
import { z } from 'zod';
import {
  DEFAULT_ANTHROPIC_MODEL,
  DEFAULT_OLLAMA_BASE_URL,
  DEFAULT_OPENAI_BASE_URL,
  type AIConfig,
  type AnthropicEffort,
} from '../providers/types.js';

/** Per-user config directory (never inside a project). */
export function getConfigDir(env: NodeJS.ProcessEnv = process.env): string {
  if (env.GAMEFORGE_CONFIG_DIR) return path.resolve(env.GAMEFORGE_CONFIG_DIR);
  const home = os.homedir();
  if (process.platform === 'win32') {
    return path.join(env.APPDATA ?? path.join(home, 'AppData', 'Roaming'), 'xyolua-gameforge');
  }
  if (process.platform === 'darwin')
    return path.join(home, 'Library', 'Application Support', 'xyolua-gameforge');
  return path.join(env.XDG_CONFIG_HOME ?? path.join(home, '.config'), 'xyolua-gameforge');
}

export const PROVIDER_IDS = ['anthropic', 'openai-compatible', 'ollama', 'mock'] as const;
const EFFORTS = ['default', 'low', 'medium', 'high', 'xhigh', 'max'] as const;

export const SettingsSchema = z.object({
  version: z.literal(1).default(1),
  ai: z
    .object({
      provider: z.string().nullable().default(null),
      anthropic: z
        .object({
          model: z.string().default(DEFAULT_ANTHROPIC_MODEL),
          baseUrl: z.string().optional(),
          effort: z.enum(EFFORTS).default('high'),
          fallbacks: z.boolean().default(true),
        })
        .prefault({}),
      openai: z
        .object({
          baseUrl: z.string().default(DEFAULT_OPENAI_BASE_URL),
          model: z.string().optional(),
          jsonMode: z.boolean().default(false),
        })
        .prefault({}),
      ollama: z
        .object({
          baseUrl: z.string().default(DEFAULT_OLLAMA_BASE_URL),
          model: z.string().optional(),
        })
        .prefault({}),
    })
    .prefault({}),
  godot: z.object({ executable: z.string().optional() }).prefault({}),
  mcp: z
    .object({
      /** The MCP server refuses to start unless enabled. */
      enabled: z.boolean().default(false),
      /** Allow MCP clients to write files / scaffold projects. */
      allowWrite: z.boolean().default(false),
    })
    .prefault({}),
  plugins: z
    .object({
      /** Ids of third-party plugins the user explicitly enabled. */
      enabled: z.array(z.string()).default([]),
    })
    .prefault({}),
  agents: z
    .object({
      maxSteps: z.number().int().min(1).max(200).default(40),
      /** "staged": review diffs before anything touches disk. */
      changeMode: z.enum(['staged', 'direct']).default('staged'),
    })
    .prefault({}),
  editor: z.object({ fontSize: z.number().min(8).max(32).default(13) }).prefault({}),
  recentProjects: z.array(z.string()).default([]),
});

export type Settings = z.infer<typeof SettingsSchema>;

export function defaultSettings(): Settings {
  return SettingsSchema.parse({});
}

export class SettingsStore {
  readonly file: string;

  constructor(readonly dir: string = getConfigDir()) {
    this.file = path.join(dir, 'settings.json');
  }

  load(): Settings {
    if (!existsSync(this.file)) return defaultSettings();
    try {
      const raw = JSON.parse(readFileSync(this.file, 'utf8')) as unknown;
      const parsed = SettingsSchema.safeParse(raw);
      return parsed.success ? parsed.data : defaultSettings();
    } catch {
      // Corrupt settings: keep a backup and start fresh rather than crash.
      try {
        renameSync(this.file, `${this.file}.corrupt`);
      } catch {
        // ignore
      }
      return defaultSettings();
    }
  }

  save(settings: Settings): Settings {
    const valid = SettingsSchema.parse(settings);
    mkdirSync(this.dir, { recursive: true });
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, `${JSON.stringify(valid, null, 2)}\n`, 'utf8');
    renameSync(tmp, this.file);
    return valid;
  }

  update(mutator: (settings: Settings) => void): Settings {
    const settings = this.load();
    mutator(settings);
    return this.save(settings);
  }

  addRecentProject(root: string): Settings {
    return this.update((s) => {
      s.recentProjects = [root, ...s.recentProjects.filter((p) => p !== root)].slice(0, 12);
    });
  }
}

/** Reads a `.env` file into an object without touching `process.env`. */
export function readDotEnv(file: string): Record<string, string> {
  if (!existsSync(file)) return {};
  try {
    return parseEnv(readFileSync(file, 'utf8')) as Record<string, string>;
  } catch {
    return {};
  }
}

export interface SecretSource {
  /** API keys stored by the desktop app (encrypted with the OS keychain). */
  anthropicApiKey?: string;
  openaiApiKey?: string;
}

/**
 * Resolves the AI configuration. Precedence: environment variables, then
 * settings, then built-in defaults. Keys only come from the environment or the
 * desktop secret store — never from settings.json.
 */
export function resolveAIConfig(
  settings: Settings,
  env: NodeJS.ProcessEnv,
  secrets: SecretSource = {},
): AIConfig {
  const effortEnv = env.ANTHROPIC_EFFORT as AnthropicEffort | undefined;
  return {
    provider:
      env.AI_PROVIDER?.trim() ||
      settings.ai.provider ||
      (env.ANTHROPIC_API_KEY ? 'anthropic' : null),
    anthropic: {
      ...(env.ANTHROPIC_API_KEY || secrets.anthropicApiKey
        ? { apiKey: env.ANTHROPIC_API_KEY || secrets.anthropicApiKey }
        : {}),
      model: env.ANTHROPIC_MODEL || settings.ai.anthropic.model,
      ...(env.ANTHROPIC_BASE_URL || settings.ai.anthropic.baseUrl
        ? { baseUrl: env.ANTHROPIC_BASE_URL || settings.ai.anthropic.baseUrl }
        : {}),
      effort:
        effortEnv && (EFFORTS as readonly string[]).includes(effortEnv)
          ? effortEnv
          : settings.ai.anthropic.effort,
      fallbacks: settings.ai.anthropic.fallbacks,
    },
    openai: {
      ...(env.OPENAI_API_KEY || secrets.openaiApiKey
        ? { apiKey: env.OPENAI_API_KEY || secrets.openaiApiKey }
        : {}),
      baseUrl: env.OPENAI_BASE_URL || settings.ai.openai.baseUrl,
      ...(env.OPENAI_MODEL || settings.ai.openai.model
        ? { model: env.OPENAI_MODEL || settings.ai.openai.model }
        : {}),
      jsonMode: settings.ai.openai.jsonMode,
    },
    ollama: {
      baseUrl: env.OLLAMA_BASE_URL || settings.ai.ollama.baseUrl,
      ...(env.OLLAMA_MODEL || settings.ai.ollama.model
        ? { model: env.OLLAMA_MODEL || settings.ai.ollama.model }
        : {}),
    },
  };
}
