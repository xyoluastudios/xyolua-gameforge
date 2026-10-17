/**
 * Provider-neutral chat model interface.
 *
 * Nothing outside `providers/` knows which AI vendor is used. Agents talk to
 * an `AIProvider`, and each provider translates to its own wire format.
 */

export type JsonSchema = { [key: string]: unknown };

export interface ToolSpec {
  name: string;
  description: string;
  inputSchema: JsonSchema;
}

export interface ToolCall {
  id: string;
  name: string;
  input: unknown;
}

export type ChatMessage =
  | { role: 'user'; content: string }
  | {
      role: 'assistant';
      content: string;
      toolCalls?: ToolCall[];
      /**
       * Provider-native representation of this turn (e.g. Anthropic content
       * blocks incl. thinking). Replayed unchanged to the same provider so
       * conversations stay append-only.
       */
      providerData?: unknown;
    }
  | { role: 'tool'; toolCallId: string; name: string; content: string; isError?: boolean };

/** What the request is for. Used for logging and by the offline mock provider. */
export type ChatPurpose = 'game-plan' | 'level-brief' | 'agent' | 'chat' | 'review';

export interface ChatRequest {
  system?: string;
  messages: ChatMessage[];
  tools?: ToolSpec[];
  maxTokens?: number;
  /** Ask the model for JSON matching this schema (best effort per provider). */
  responseSchema?: { name: string; schema: JsonSchema };
  purpose?: ChatPurpose;
  signal?: AbortSignal;
  /** Streaming text callback (optional). */
  onText?: (delta: string) => void;
}

export type StopReason = 'end' | 'tool_use' | 'max_tokens' | 'refusal' | 'other';

export interface ChatResponse {
  text: string;
  toolCalls: ToolCall[];
  stopReason: StopReason;
  model: string;
  usage?: { inputTokens: number; outputTokens: number };
  providerData?: unknown;
}

export interface HealthResult {
  ok: boolean;
  message: string;
}

export interface ProviderCapabilities {
  /** Can call tools (needed for code-writing agents). */
  tools: boolean;
  /** Is a real language model (false for the offline mock). */
  generative: boolean;
}

export interface AIProvider {
  readonly id: string;
  readonly displayName: string;
  readonly model: string;
  readonly capabilities: ProviderCapabilities;
  chat(request: ChatRequest): Promise<ChatResponse>;
  /** Verifies configuration and connectivity without generating text where possible. */
  healthCheck(signal?: AbortSignal): Promise<HealthResult>;
}

export type AnthropicEffort = 'default' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';

export interface AIConfig {
  provider: string | null;
  anthropic: {
    apiKey?: string;
    model: string;
    baseUrl?: string;
    effort: AnthropicEffort;
    /** Send `fallbacks: "default"` (server-side refusal fallback). */
    fallbacks: boolean;
  };
  openai: { apiKey?: string; baseUrl: string; model?: string; jsonMode: boolean };
  ollama: { baseUrl: string; model?: string };
}

export const DEFAULT_ANTHROPIC_MODEL = 'claude-opus-5-5';
export const DEFAULT_OPENAI_BASE_URL = 'https://api.openai.com/v1';
export const DEFAULT_OLLAMA_BASE_URL = 'http://localhost:11434';
