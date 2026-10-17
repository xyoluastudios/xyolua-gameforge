/**
 * @gameforge/core — public API.
 *
 * Engine-agnostic building blocks of XyoLua GameForge: AI providers, agents,
 * sandboxed tools, permissions, git, plugins and the application facade.
 */

export * from './errors.js';
export * from './logger.js';
export * from './events.js';
export * from './events-types.js';
export * from './secrets.js';

export * from './config/settings.js';

export * from './providers/types.js';
export * from './providers/registry.js';
export {
  AnthropicProvider,
  toAnthropicMessages,
  mapAnthropicError,
} from './providers/anthropic.js';
export { OpenAICompatibleProvider, toOpenAIMessages } from './providers/openai-compatible.js';
export { OllamaProvider, toOllamaMessages } from './providers/ollama.js';
export { MockProvider, type MockStep } from './providers/mock.js';

export * from './plan/game-plan.js';
export { offlinePlan } from './plan/offline-planner.js';

export * from './workspace/workspace.js';
export * from './workspace/changeset.js';
export * from './workspace/diff.js';
export { resolveInside, protectionFor, toPosix } from './workspace/path-guard.js';

export * from './permissions/permissions.js';
export * from './process/command.js';

export * from './tools/types.js';
export * from './tools/registry.js';
export * from './tools/builtin.js';

export * from './git/git.js';

export * from './engines/types.js';

export * from './agents/definitions.js';
export * from './agents/runner.js';

export * from './plugins/plugins.js';

export * from './app.js';
export * from './project.js';
export * from './doctor.js';
