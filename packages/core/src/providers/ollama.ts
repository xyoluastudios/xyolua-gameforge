import { GameForgeError } from '../errors.js';
import { joinUrl, requestJson, type HttpErrorContext } from './http.js';
import type {
  AIConfig,
  AIProvider,
  ChatMessage,
  ChatRequest,
  ChatResponse,
  HealthResult,
} from './types.js';

interface OllamaMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  tool_calls?: { function: { name: string; arguments: unknown } }[];
  tool_name?: string;
}

interface OllamaChatResponse {
  model?: string;
  message?: {
    content?: string;
    tool_calls?: { function?: { name?: string; arguments?: unknown } }[];
  };
  done_reason?: string;
  prompt_eval_count?: number;
  eval_count?: number;
}

export function toOllamaMessages(
  system: string | undefined,
  messages: ChatMessage[],
): OllamaMessage[] {
  const result: OllamaMessage[] = [];
  if (system) result.push({ role: 'system', content: system });
  for (const message of messages) {
    if (message.role === 'user') result.push({ role: 'user', content: message.content });
    else if (message.role === 'tool') {
      result.push({ role: 'tool', content: message.content, tool_name: message.name });
    } else {
      result.push({
        role: 'assistant',
        content: message.content,
        ...(message.toolCalls?.length
          ? {
              tool_calls: message.toolCalls.map((c) => ({
                function: { name: c.name, arguments: c.input ?? {} },
              })),
            }
          : {}),
      });
    }
  }
  return result;
}

/** Local models through Ollama (https://ollama.com). No API key, nothing leaves the machine. */
export class OllamaProvider implements AIProvider {
  readonly id = 'ollama';
  readonly displayName = 'Ollama';
  readonly capabilities = { tools: true, generative: true };
  readonly model: string;
  private readonly context: HttpErrorContext;
  private callCounter = 0;

  constructor(private readonly config: AIConfig['ollama']) {
    if (!config.model) {
      throw new GameForgeError('PROVIDER_NOT_CONFIGURED', 'Ollama is not configured.', {
        reason: 'No model name was set (OLLAMA_MODEL).',
        solution: 'Open Settings → AI Provider → Ollama and choose a model (see `ollama list`).',
      });
    }
    this.model = config.model;
    this.context = {
      providerName: 'Ollama',
      settingsHint: 'Open Settings → AI Provider → Ollama',
      baseUrl: config.baseUrl,
      unreachableHint: 'Is Ollama running? Start it with `ollama serve` and check the base URL.',
    };
  }

  async chat(request: ChatRequest): Promise<ChatResponse> {
    const body: Record<string, unknown> = {
      model: this.model,
      messages: toOllamaMessages(request.system, request.messages),
      stream: false,
      options: { num_predict: request.maxTokens ?? 8192 },
    };
    if (request.tools?.length) {
      body.tools = request.tools.map((tool) => ({
        type: 'function',
        function: { name: tool.name, description: tool.description, parameters: tool.inputSchema },
      }));
    }
    if (request.responseSchema) body.format = request.responseSchema.schema;

    const data = await requestJson<OllamaChatResponse>(
      joinUrl(this.config.baseUrl, 'api/chat'),
      { body, ...(request.signal ? { signal: request.signal } : {}) },
      this.context,
    );
    const text = data.message?.content ?? '';
    if (text) request.onText?.(text);
    const toolCalls = (data.message?.tool_calls ?? []).map((call) => ({
      id: `ollama_call_${++this.callCounter}`,
      name: call.function?.name ?? '',
      input:
        typeof call.function?.arguments === 'string'
          ? safeJson(call.function.arguments)
          : (call.function?.arguments ?? {}),
    }));
    return {
      text,
      toolCalls,
      stopReason: toolCalls.length
        ? 'tool_use'
        : data.done_reason === 'length'
          ? 'max_tokens'
          : 'end',
      model: data.model ?? this.model,
      usage: { inputTokens: data.prompt_eval_count ?? 0, outputTokens: data.eval_count ?? 0 },
    };
  }

  async healthCheck(signal?: AbortSignal): Promise<HealthResult> {
    try {
      const data = await requestJson<{ models?: { name: string; model?: string }[] }>(
        joinUrl(this.config.baseUrl, 'api/tags'),
        { method: 'GET', timeoutMs: 10_000, ...(signal ? { signal } : {}) },
        this.context,
      );
      const names = (data.models ?? []).flatMap((m) => [m.name, m.model ?? '']);
      const wanted = this.model.includes(':') ? this.model : `${this.model}:latest`;
      if (!names.includes(this.model) && !names.includes(wanted)) {
        return {
          ok: false,
          message: `Ollama is running, but model "${this.model}" is not installed. Run: ollama pull ${this.model}`,
        };
      }
      return { ok: true, message: `Ollama running, model ${this.model} installed.` };
    } catch (error) {
      const e = error instanceof GameForgeError ? error : null;
      return {
        ok: false,
        message: [e?.reason ?? String(error), e?.solution].filter(Boolean).join(' — '),
      };
    }
  }
}

function safeJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return { __invalid_json__: raw };
  }
}
