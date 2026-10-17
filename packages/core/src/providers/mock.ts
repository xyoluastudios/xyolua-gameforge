import { offlinePlan } from '../plan/offline-planner.js';
import type { AIProvider, ChatRequest, ChatResponse, HealthResult } from './types.js';

export type MockStep = Partial<ChatResponse> | ((request: ChatRequest) => Partial<ChatResponse>);

/**
 * Mock provider for development and tests — clearly labeled, never a real AI.
 *
 * - With a `script`, it replays the given responses in order (unit tests).
 * - Without a script it runs in **offline mode**: game plans come from the
 *   deterministic keyword planner, and agent requests get an honest answer
 *   that no AI is configured. Nothing is sent over the network.
 */
export class MockProvider implements AIProvider {
  readonly id = 'mock';
  readonly displayName: string;
  readonly model: string;
  readonly capabilities: { tools: boolean; generative: boolean };
  /** Every request the provider received (handy for assertions). */
  readonly requests: ChatRequest[] = [];
  private readonly script: MockStep[] | null;

  constructor(options: { script?: MockStep[]; generative?: boolean } = {}) {
    this.script = options.script ? [...options.script] : null;
    this.model = this.script ? 'mock-scripted' : 'offline';
    this.displayName = this.script ? 'Mock (scripted)' : 'Mock (offline, no AI)';
    // Scripted mocks behave like a real tool-calling model in tests.
    this.capabilities = { tools: true, generative: options.generative ?? !!this.script };
  }

  get remaining(): number {
    return this.script?.length ?? Infinity;
  }

  async chat(request: ChatRequest): Promise<ChatResponse> {
    // Snapshot: callers keep appending to the same messages array.
    this.requests.push({ ...request, messages: [...request.messages] });
    if (this.script) {
      const step = this.script.shift();
      if (!step)
        throw new Error('MockProvider script exhausted — the test expected fewer AI calls.');
      const partial = typeof step === 'function' ? step(request) : step;
      const response: ChatResponse = {
        text: partial.text ?? '',
        toolCalls: partial.toolCalls ?? [],
        stopReason:
          partial.stopReason ?? ((partial.toolCalls?.length ?? 0) > 0 ? 'tool_use' : 'end'),
        model: this.model,
        ...(partial.usage ? { usage: partial.usage } : {}),
      };
      if (response.text) request.onText?.(response.text);
      return response;
    }
    return this.offline(request);
  }

  private offline(request: ChatRequest): ChatResponse {
    const lastUser = [...request.messages].reverse().find((m) => m.role === 'user');
    const prompt = lastUser?.role === 'user' ? lastUser.content : '';
    let text: string;
    switch (request.purpose) {
      case 'game-plan': {
        const description = /<description>([\s\S]*?)<\/description>/.exec(prompt)?.[1] ?? prompt;
        text = JSON.stringify(offlinePlan(description));
        break;
      }
      case 'level-brief':
        // Empty brief → the generator uses plan defaults.
        text = '{}';
        break;
      default:
        text =
          'The offline mock provider is active, so no AI is available to write or change code.\n' +
          'Configure Anthropic, an OpenAI-compatible API or Ollama in Settings → AI Provider.\n' +
          'Built-in actions still work without AI: "run tests", "run game", "analyze", "fix", "git status".';
    }
    request.onText?.(text);
    return { text, toolCalls: [], stopReason: 'end', model: this.model };
  }

  async healthCheck(): Promise<HealthResult> {
    return { ok: true, message: 'Mock provider active (offline, no AI).' };
  }
}
