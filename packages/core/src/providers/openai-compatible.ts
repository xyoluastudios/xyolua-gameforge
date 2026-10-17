import { GameForgeError } from '../errors.js';
import { joinUrl, requestJson, type HttpErrorContext } from './http.js';
import type {
  AIConfig,
  AIProvider,
  ChatMessage,
  ChatRequest,
  ChatResponse,
  HealthResult,
  StopReason,
} from './types.js';

interface OpenAIMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: { id: string; type: 'function'; function: { name: string; arguments: string } }[];
  tool_call_id?: string;
}

interface OpenAIChatResponse {
  model?: string;
  choices?: {
    message?: {
      content?: string | null;
      tool_calls?: { id?: string; function?: { name?: string; arguments?: string } }[];
    };
    finish_reason?: string | null;
  }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

export function toOpenAIMessages(
  system: string | undefined,
  messages: ChatMessage[],
): OpenAIMessage[] {
  const result: OpenAIMessage[] = [];
  if (system) result.push({ role: 'system', content: system });
  for (const message of messages) {
    if (message.role === 'user') result.push({ role: 'user', content: message.content });
    else if (message.role === 'tool') {
      result.push({ role: 'tool', tool_call_id: message.toolCallId, content: message.content });
    } else {
      const toolCalls = message.toolCalls?.map((call) => ({
        id: call.id,
        type: 'function' as const,
        function: { name: call.name, arguments: JSON.stringify(call.input ?? {}) },
      }));
      result.push({
        role: 'assistant',
        content: message.content || (toolCalls?.length ? null : ''),
        ...(toolCalls?.length ? { tool_calls: toolCalls } : {}),
      });
    }
  }
  return result;
}

function parseArguments(raw: string | undefined): unknown {
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    // Returned as-is; the tool registry reports the validation error to the model.
    return { __invalid_json__: raw };
  }
}

function mapFinish(reason: string | null | undefined, hasTools: boolean): StopReason {
  if (hasTools || reason === 'tool_calls' || reason === 'function_call') return 'tool_use';
  if (reason === 'length') return 'max_tokens';
  if (reason === 'content_filter') return 'refusal';
  if (reason === 'stop' || reason == null) return 'end';
  return 'other';
}

/**
 * Works with any server implementing the OpenAI Chat Completions API:
 * OpenAI, OpenRouter, Groq, Together, LM Studio, vLLM, llama.cpp server, ...
 */
export class OpenAICompatibleProvider implements AIProvider {
  readonly id = 'openai-compatible';
  readonly displayName = 'OpenAI-compatible';
  readonly capabilities = { tools: true, generative: true };
  readonly model: string;
  private readonly context: HttpErrorContext;

  constructor(private readonly config: AIConfig['openai']) {
    if (!config.model) {
      throw new GameForgeError(
        'PROVIDER_NOT_CONFIGURED',
        'OpenAI-compatible provider is not configured.',
        {
          reason: 'No model name was set (OPENAI_MODEL).',
          solution: 'Open Settings → AI Provider → OpenAI-compatible and enter a model name.',
        },
      );
    }
    this.model = config.model;
    this.context = {
      providerName: 'the OpenAI-compatible API',
      settingsHint: 'Open Settings → AI Provider → OpenAI-compatible',
      baseUrl: config.baseUrl,
    };
  }

  private headers(): Record<string, string> {
    return this.config.apiKey ? { authorization: `Bearer ${this.config.apiKey}` } : {};
  }

  async chat(request: ChatRequest): Promise<ChatResponse> {
    const body: Record<string, unknown> = {
      model: this.model,
      messages: toOpenAIMessages(request.system, request.messages),
      max_tokens: request.maxTokens ?? 8192,
    };
    if (request.tools?.length) {
      body.tools = request.tools.map((tool) => ({
        type: 'function',
        function: { name: tool.name, description: tool.description, parameters: tool.inputSchema },
      }));
    }
    if (request.responseSchema && this.config.jsonMode) {
      body.response_format = {
        type: 'json_schema',
        json_schema: { name: request.responseSchema.name, schema: request.responseSchema.schema },
      };
    }
    const data = await requestJson<OpenAIChatResponse>(
      joinUrl(this.config.baseUrl, 'chat/completions'),
      { headers: this.headers(), body, ...(request.signal ? { signal: request.signal } : {}) },
      this.context,
    );
    const choice = data.choices?.[0];
    if (!choice?.message) {
      throw new GameForgeError('PROVIDER_BAD_RESPONSE', 'AI request failed.', {
        reason: 'The server returned no message.',
      });
    }
    const toolCalls = (choice.message.tool_calls ?? []).map((call, index) => ({
      id: call.id ?? `call_${index}`,
      name: call.function?.name ?? '',
      input: parseArguments(call.function?.arguments),
    }));
    const text = choice.message.content ?? '';
    if (text) request.onText?.(text);
    return {
      text,
      toolCalls,
      stopReason: mapFinish(choice.finish_reason, toolCalls.length > 0),
      model: data.model ?? this.model,
      ...(data.usage
        ? {
            usage: {
              inputTokens: data.usage.prompt_tokens ?? 0,
              outputTokens: data.usage.completion_tokens ?? 0,
            },
          }
        : {}),
    };
  }

  async healthCheck(signal?: AbortSignal): Promise<HealthResult> {
    try {
      const data = await requestJson<{ data?: { id: string }[] }>(
        joinUrl(this.config.baseUrl, 'models'),
        {
          method: 'GET',
          headers: this.headers(),
          timeoutMs: 15_000,
          ...(signal ? { signal } : {}),
        },
        this.context,
      );
      const ids = (data.data ?? []).map((m) => m.id);
      if (ids.length && !ids.includes(this.model)) {
        return {
          ok: false,
          message: `Connected, but model "${this.model}" is not listed by the server.`,
        };
      }
      return { ok: true, message: `Connected to ${this.config.baseUrl}.` };
    } catch (error) {
      const e = error instanceof GameForgeError ? error : null;
      return {
        ok: false,
        message: [e?.reason ?? String(error), e?.solution].filter(Boolean).join(' — '),
      };
    }
  }
}
