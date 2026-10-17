import Anthropic from '@anthropic-ai/sdk';
import { GameForgeError } from '../errors.js';
import type {
  AIConfig,
  AIProvider,
  ChatMessage,
  ChatRequest,
  ChatResponse,
  HealthResult,
  StopReason,
  ToolCall,
} from './types.js';

type BetaMessageParam = Anthropic.Beta.Messages.BetaMessageParam;
type BetaContentBlockParam = Anthropic.Beta.Messages.BetaContentBlockParam;
type BetaToolResultBlockParam = Anthropic.Beta.Messages.BetaToolResultBlockParam;
type BetaTool = Anthropic.Beta.Messages.BetaTool;
type BetaMessage = Anthropic.Beta.Messages.BetaMessage;

const SETTINGS_HINT = 'Open Settings → AI Provider → Anthropic';

/** Converts provider-neutral messages into Anthropic Messages API params (append-only). */
export function toAnthropicMessages(messages: ChatMessage[]): BetaMessageParam[] {
  const result: BetaMessageParam[] = [];
  let pendingResults: BetaToolResultBlockParam[] = [];

  const flushResults = () => {
    if (pendingResults.length === 0) return;
    // All tool results of one turn go into a single user message.
    result.push({ role: 'user', content: pendingResults });
    pendingResults = [];
  };

  for (const message of messages) {
    if (message.role === 'tool') {
      pendingResults.push({
        type: 'tool_result',
        tool_use_id: message.toolCallId,
        content: message.content,
        ...(message.isError ? { is_error: true } : {}),
      });
      continue;
    }
    flushResults();
    if (message.role === 'user') {
      result.push({ role: 'user', content: message.content });
      continue;
    }
    // Assistant: replay native content (thinking, fallback blocks, ...) unchanged when we have it.
    if (Array.isArray(message.providerData)) {
      result.push({ role: 'assistant', content: message.providerData as BetaContentBlockParam[] });
      continue;
    }
    const blocks: BetaContentBlockParam[] = [];
    if (message.content) blocks.push({ type: 'text', text: message.content });
    for (const call of message.toolCalls ?? []) {
      blocks.push({ type: 'tool_use', id: call.id, name: call.name, input: call.input ?? {} });
    }
    result.push({
      role: 'assistant',
      content: blocks.length ? blocks : [{ type: 'text', text: '' }],
    });
  }
  flushResults();
  return result;
}

function mapStopReason(reason: string | null): StopReason {
  switch (reason) {
    case 'end_turn':
    case 'stop_sequence':
      return 'end';
    case 'tool_use':
      return 'tool_use';
    case 'max_tokens':
    case 'model_context_window_exceeded':
      return 'max_tokens';
    case 'refusal':
      return 'refusal';
    default:
      return 'other';
  }
}

/** Maps SDK errors to user-facing errors with a concrete solution. */
export function mapAnthropicError(error: unknown): GameForgeError {
  if (error instanceof GameForgeError) return error;
  if (error instanceof Anthropic.AuthenticationError) {
    return new GameForgeError('INVALID_API_KEY', 'AI request failed.', {
      reason: 'Invalid API key.',
      solution: SETTINGS_HINT,
      cause: error,
    });
  }
  if (error instanceof Anthropic.PermissionDeniedError) {
    return new GameForgeError('INVALID_API_KEY', 'AI request failed.', {
      reason: 'This API key is not allowed to use the selected model.',
      solution: `${SETTINGS_HINT} and check the key's permissions or choose another model.`,
      cause: error,
    });
  }
  if (error instanceof Anthropic.NotFoundError) {
    return new GameForgeError('MODEL_NOT_FOUND', 'AI request failed.', {
      reason: 'The configured model was not found.',
      solution: `${SETTINGS_HINT} and check the model name.`,
      cause: error,
    });
  }
  if (error instanceof Anthropic.RateLimitError) {
    return new GameForgeError('PROVIDER_RATE_LIMITED', 'AI request failed.', {
      reason: 'Rate limit reached for your Anthropic account.',
      solution: 'Wait a moment and try again, or check your usage limits in the Anthropic Console.',
      cause: error,
    });
  }
  if (error instanceof Anthropic.InternalServerError) {
    return new GameForgeError('PROVIDER_OVERLOADED', 'AI request failed.', {
      reason: 'The Anthropic API is temporarily unavailable or overloaded.',
      solution: 'Try again in a few moments.',
      cause: error,
    });
  }
  if (error instanceof Anthropic.APIConnectionError) {
    return new GameForgeError('PROVIDER_UNREACHABLE', 'AI request failed.', {
      reason: 'Could not reach the Anthropic API.',
      solution: 'Check your internet connection (and proxy / base URL settings).',
      cause: error,
    });
  }
  if (error instanceof Anthropic.BadRequestError) {
    return new GameForgeError('PROVIDER_REQUEST_FAILED', 'AI request failed.', {
      reason: error.message,
      solution: `${SETTINGS_HINT} — check the model and effort settings.`,
      cause: error,
    });
  }
  if (error instanceof Anthropic.APIError) {
    return new GameForgeError('PROVIDER_REQUEST_FAILED', 'AI request failed.', {
      reason: error.message,
      cause: error,
    });
  }
  if (error instanceof Error && error.name === 'AbortError') {
    return new GameForgeError('CANCELLED', 'The AI request was cancelled.', { cause: error });
  }
  return new GameForgeError('PROVIDER_REQUEST_FAILED', 'AI request failed.', {
    reason: error instanceof Error ? error.message : String(error),
    cause: error,
  });
}

export class AnthropicProvider implements AIProvider {
  readonly id = 'anthropic';
  readonly displayName = 'Anthropic';
  readonly capabilities = { tools: true, generative: true };
  readonly model: string;
  private readonly client: Anthropic;

  constructor(private readonly config: AIConfig['anthropic']) {
    if (!config.apiKey) {
      throw new GameForgeError('PROVIDER_NOT_CONFIGURED', 'Anthropic is not configured.', {
        reason: 'No API key was found (ANTHROPIC_API_KEY).',
        solution: `${SETTINGS_HINT}, or set ANTHROPIC_API_KEY in your environment / .env file.`,
      });
    }
    this.model = config.model;
    this.client = new Anthropic({
      apiKey: config.apiKey,
      ...(config.baseUrl ? { baseURL: config.baseUrl } : {}),
      maxRetries: 2,
    });
  }

  async chat(request: ChatRequest): Promise<ChatResponse> {
    const tools: BetaTool[] | undefined = request.tools?.map((tool) => ({
      name: tool.name,
      description: tool.description,
      input_schema: tool.inputSchema as BetaTool['input_schema'],
      // Large tool inputs (whole files) stream as they are generated. The
      // server no longer validates them, so the tool registry validates every
      // input against its schema before running it.
      eager_input_streaming: true,
    }));

    const outputConfig: Anthropic.Beta.Messages.BetaOutputConfig = {};
    if (this.config.effort !== 'default') outputConfig.effort = this.config.effort;
    if (request.responseSchema) {
      outputConfig.format = { type: 'json_schema', schema: request.responseSchema.schema };
    }

    let message: BetaMessage;
    try {
      const stream = this.client.beta.messages.stream(
        {
          model: this.model,
          max_tokens: request.maxTokens ?? 64000,
          messages: toAnthropicMessages(request.messages),
          ...(request.system ? { system: request.system } : {}),
          ...(tools && tools.length ? { tools } : {}),
          ...(Object.keys(outputConfig).length ? { output_config: outputConfig } : {}),
          ...(this.config.fallbacks
            ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const }
            : {}),
        },
        request.signal ? { signal: request.signal } : undefined,
      );
      if (request.onText) stream.on('text', (delta) => request.onText?.(delta));
      message = await stream.finalMessage();
    } catch (error) {
      throw mapAnthropicError(error);
    }

    const text = message.content
      .filter((b): b is Anthropic.Beta.Messages.BetaTextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('');
    const toolCalls: ToolCall[] = message.content
      .filter((b): b is Anthropic.Beta.Messages.BetaToolUseBlock => b.type === 'tool_use')
      .map((b) => ({ id: b.id, name: b.name, input: b.input }));

    return {
      text,
      toolCalls,
      stopReason: mapStopReason(message.stop_reason),
      model: message.model,
      usage: { inputTokens: message.usage.input_tokens, outputTokens: message.usage.output_tokens },
      providerData: message.content,
    };
  }

  async healthCheck(signal?: AbortSignal): Promise<HealthResult> {
    try {
      await this.client.models.retrieve(this.model, {}, signal ? { signal } : undefined);
      return { ok: true, message: `Anthropic API reachable, model ${this.model} available.` };
    } catch (error) {
      const mapped = mapAnthropicError(error);
      return {
        ok: false,
        message: [mapped.reason ?? mapped.message, mapped.solution].filter(Boolean).join(' — '),
      };
    }
  }
}
