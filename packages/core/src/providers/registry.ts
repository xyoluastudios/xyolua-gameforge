import { GameForgeError } from '../errors.js';
import { AnthropicProvider } from './anthropic.js';
import { MockProvider } from './mock.js';
import { OllamaProvider } from './ollama.js';
import { OpenAICompatibleProvider } from './openai-compatible.js';
import type { AIConfig, AIProvider } from './types.js';

export interface ProviderFactory {
  id: string;
  displayName: string;
  /** Short hint shown in Settings / doctor. */
  description: string;
  create(config: AIConfig): AIProvider;
}

/** Built-in providers. Plugins can register more (AIProviderPlugin). */
export const BUILTIN_PROVIDERS: ProviderFactory[] = [
  {
    id: 'anthropic',
    displayName: 'Anthropic',
    description: 'Claude models via the Anthropic API (your own API key).',
    create: (config) => new AnthropicProvider(config.anthropic),
  },
  {
    id: 'openai-compatible',
    displayName: 'OpenAI-compatible',
    description: 'Any Chat Completions API: OpenAI, OpenRouter, Groq, LM Studio, vLLM, ...',
    create: (config) => new OpenAICompatibleProvider(config.openai),
  },
  {
    id: 'ollama',
    displayName: 'Ollama',
    description: 'Local models through Ollama. Nothing leaves your machine.',
    create: (config) => new OllamaProvider(config.ollama),
  },
  {
    id: 'mock',
    displayName: 'Mock (offline)',
    description: 'No AI. Deterministic offline planner for testing GameForge without a key.',
    create: () => new MockProvider(),
  },
];

export class ProviderRegistry {
  private readonly factories = new Map<string, ProviderFactory>();

  constructor(factories: ProviderFactory[] = BUILTIN_PROVIDERS) {
    for (const factory of factories) this.register(factory);
  }

  register(factory: ProviderFactory): void {
    if (this.factories.has(factory.id)) {
      throw new GameForgeError(
        'PLUGIN_FAILED',
        `AI provider "${factory.id}" is already registered.`,
      );
    }
    this.factories.set(factory.id, factory);
  }

  list(): ProviderFactory[] {
    return [...this.factories.values()];
  }

  get(id: string): ProviderFactory | undefined {
    return this.factories.get(id);
  }

  /** Creates the configured provider or throws a helpful error. */
  create(config: AIConfig): AIProvider {
    if (!config.provider) {
      throw new GameForgeError('PROVIDER_NOT_CONFIGURED', 'No AI provider is configured.', {
        reason: 'GameForge needs an AI provider to plan and write code.',
        solution:
          'Open Settings → AI Provider, or set AI_PROVIDER (anthropic, openai-compatible, ollama) in your .env. ' +
          'Use AI_PROVIDER=mock to try GameForge offline without AI.',
      });
    }
    const factory = this.factories.get(config.provider);
    if (!factory) {
      throw new GameForgeError(
        'PROVIDER_NOT_CONFIGURED',
        `Unknown AI provider "${config.provider}".`,
        {
          solution: `Use one of: ${this.list()
            .map((f) => f.id)
            .join(', ')}.`,
        },
      );
    }
    return factory.create(config);
  }
}
