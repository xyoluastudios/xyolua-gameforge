import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AnthropicProvider, toAnthropicMessages } from '../src/providers/anthropic.js';
import { MockProvider } from '../src/providers/mock.js';
import { OllamaProvider } from '../src/providers/ollama.js';
import { OpenAICompatibleProvider } from '../src/providers/openai-compatible.js';
import { ProviderRegistry } from '../src/providers/registry.js';
import type { AIConfig, ChatMessage } from '../src/providers/types.js';
import { parseGamePlan } from '../src/plan/game-plan.js';

const TOOL = {
  name: 'read_file',
  description: 'Read a file',
  inputSchema: { type: 'object', properties: { path: { type: 'string' } } },
};

let server: Server | null = null;
afterEach(async () => {
  vi.unstubAllGlobals();
  await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
  server = null;
});

async function startServer(
  handler: (req: IncomingMessage, body: string, res: ServerResponse) => void,
): Promise<string> {
  server = createServer((req, res) => {
    let body = '';
    req.on('data', (c: Buffer) => (body += c.toString()));
    req.on('end', () => handler(req, body, res));
  });
  await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${(server!.address() as AddressInfo).port}`;
}

const sse = (events: Record<string, unknown>[]) =>
  events.map((e) => `event: ${String(e.type)}\ndata: ${JSON.stringify(e)}\n\n`).join('');

const anthropicConfig = (baseUrl: string): AIConfig['anthropic'] => ({
  apiKey: 'sk-ant-test-key-1234567890',
  model: 'claude-opus-5-5',
  baseUrl,
  effort: 'high',
  fallbacks: true,
});

describe('AnthropicProvider', () => {
  it('streams text and tool calls through the Messages API', async () => {
    let seen: { headers: IncomingMessage['headers']; body: Record<string, unknown> } | null = null;
    const baseUrl = await startServer((req, body, res) => {
      seen = { headers: req.headers, body: JSON.parse(body) as Record<string, unknown> };
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.end(
        sse([
          {
            type: 'message_start',
            message: {
              id: 'msg_1',
              type: 'message',
              role: 'assistant',
              model: 'claude-opus-5-5',
              content: [],
              stop_reason: null,
              stop_sequence: null,
              usage: { input_tokens: 12, output_tokens: 1 },
            },
          },
          { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
          {
            type: 'content_block_delta',
            index: 0,
            delta: { type: 'text_delta', text: 'Reading the player script.' },
          },
          { type: 'content_block_stop', index: 0 },
          {
            type: 'content_block_start',
            index: 1,
            content_block: { type: 'tool_use', id: 'toolu_1', name: 'read_file', input: {} },
          },
          {
            type: 'content_block_delta',
            index: 1,
            delta: { type: 'input_json_delta', partial_json: '{"path": "scripts/player.gd"}' },
          },
          { type: 'content_block_stop', index: 1 },
          {
            type: 'message_delta',
            delta: { stop_reason: 'tool_use', stop_sequence: null },
            usage: { output_tokens: 30 },
          },
          { type: 'message_stop' },
        ]),
      );
    });
    const provider = new AnthropicProvider(anthropicConfig(baseUrl));
    const deltas: string[] = [];
    const response = await provider.chat({
      system: 'You are a test.',
      messages: [{ role: 'user', content: 'hi' }],
      tools: [TOOL],
      onText: (d) => deltas.push(d),
    });
    expect(response.text).toBe('Reading the player script.');
    expect(deltas.join('')).toBe('Reading the player script.');
    expect(response.toolCalls).toEqual([
      { id: 'toolu_1', name: 'read_file', input: { path: 'scripts/player.gd' } },
    ]);
    expect(response.stopReason).toBe('tool_use');
    expect(Array.isArray(response.providerData)).toBe(true);

    expect(seen).not.toBeNull();
    const { headers, body } = seen!;
    expect(headers['x-api-key']).toBe('sk-ant-test-key-1234567890');
    expect(String(headers['anthropic-beta'])).toContain('server-side-fallback-2026-07-01');
    expect(body.model).toBe('claude-opus-5-5');
    expect(body.fallbacks).toBe('default');
    expect(body.stream).toBe(true);
    expect(body.output_config).toEqual({ effort: 'high' });
    expect((body.tools as { eager_input_streaming: boolean }[])[0]!.eager_input_streaming).toBe(
      true,
    );
  });

  it('maps an invalid key to a friendly error', async () => {
    const baseUrl = await startServer((_req, _body, res) => {
      res.writeHead(401, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          type: 'error',
          error: { type: 'authentication_error', message: 'invalid x-api-key' },
        }),
      );
    });
    const provider = new AnthropicProvider(anthropicConfig(baseUrl));
    await expect(
      provider.chat({ messages: [{ role: 'user', content: 'hi' }] }),
    ).rejects.toMatchObject({
      code: 'INVALID_API_KEY',
      reason: 'Invalid API key.',
      solution: 'Open Settings → AI Provider → Anthropic',
    });
  });

  it('requires an API key', () => {
    expect(
      () =>
        new AnthropicProvider({
          ...anthropicConfig('http://x'),
          apiKey: undefined,
        } as AIConfig['anthropic']),
    ).toThrowError(/not configured/);
  });

  it('groups tool results into one user turn and replays native content', () => {
    const messages: ChatMessage[] = [
      { role: 'user', content: 'go' },
      {
        role: 'assistant',
        content: '',
        toolCalls: [
          { id: 'a', name: 'read_file', input: {} },
          { id: 'b', name: 'list_files', input: {} },
        ],
      },
      { role: 'tool', toolCallId: 'a', name: 'read_file', content: 'A' },
      { role: 'tool', toolCallId: 'b', name: 'list_files', content: 'B', isError: true },
      {
        role: 'assistant',
        content: 'done',
        providerData: [
          { type: 'thinking', thinking: '', signature: 'sig' },
          { type: 'text', text: 'done' },
        ],
      },
    ];
    const converted = toAnthropicMessages(messages);
    expect(converted).toHaveLength(4);
    expect(converted[2]).toEqual({
      role: 'user',
      content: [
        { type: 'tool_result', tool_use_id: 'a', content: 'A' },
        { type: 'tool_result', tool_use_id: 'b', content: 'B', is_error: true },
      ],
    });
    expect((converted[3]!.content as { type: string }[])[0]!.type).toBe('thinking');
  });
});

describe('OpenAICompatibleProvider', () => {
  it('sends chat completions with tools and parses tool calls', async () => {
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as { messages: unknown[]; tools: unknown[] };
      expect(body.messages[0]).toEqual({ role: 'system', content: 'sys' });
      expect(body.tools).toHaveLength(1);
      return new Response(
        JSON.stringify({
          model: 'gpt-test',
          choices: [
            {
              message: {
                content: null,
                tool_calls: [
                  {
                    id: 'c1',
                    type: 'function',
                    function: { name: 'read_file', arguments: '{"path":"a.gd"}' },
                  },
                ],
              },
              finish_reason: 'tool_calls',
            },
          ],
          usage: { prompt_tokens: 5, completion_tokens: 7 },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    });
    vi.stubGlobal('fetch', fetchMock);
    const provider = new OpenAICompatibleProvider({
      apiKey: 'sk-test',
      baseUrl: 'https://example.test/v1/',
      model: 'gpt-test',
      jsonMode: false,
    });
    const response = await provider.chat({
      system: 'sys',
      messages: [{ role: 'user', content: 'hi' }],
      tools: [TOOL],
    });
    expect(fetchMock.mock.calls[0]![0]).toBe('https://example.test/v1/chat/completions');
    expect((fetchMock.mock.calls[0]![1].headers as Record<string, string>).authorization).toBe(
      'Bearer sk-test',
    );
    expect(response.toolCalls).toEqual([{ id: 'c1', name: 'read_file', input: { path: 'a.gd' } }]);
    expect(response.stopReason).toBe('tool_use');
    expect(response.usage).toEqual({ inputTokens: 5, outputTokens: 7 });
  });

  it('maps 401 to INVALID_API_KEY', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ error: { message: 'bad key' } }), { status: 401 }),
      ),
    );
    const provider = new OpenAICompatibleProvider({
      apiKey: 'x',
      baseUrl: 'https://example.test/v1',
      model: 'm',
      jsonMode: false,
    });
    await expect(
      provider.chat({ messages: [{ role: 'user', content: 'hi' }] }),
    ).rejects.toMatchObject({ code: 'INVALID_API_KEY' });
  });
});

describe('OllamaProvider', () => {
  it('talks to /api/chat and reports unreachable servers helpfully', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        expect(url).toBe('http://localhost:11434/api/chat');
        return new Response(
          JSON.stringify({
            model: 'llama',
            message: {
              content: '',
              tool_calls: [{ function: { name: 'read_file', arguments: { path: 'a.gd' } } }],
            },
            done_reason: 'stop',
          }),
          { status: 200 },
        );
      }),
    );
    const provider = new OllamaProvider({ baseUrl: 'http://localhost:11434', model: 'llama' });
    const response = await provider.chat({
      messages: [{ role: 'user', content: 'hi' }],
      tools: [TOOL],
    });
    expect(response.toolCalls[0]).toMatchObject({ name: 'read_file', input: { path: 'a.gd' } });
    expect(response.stopReason).toBe('tool_use');

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('fetch failed');
      }),
    );
    const health = await provider.healthCheck();
    expect(health.ok).toBe(false);
    expect(health.message).toContain('ollama serve');
  });
});

describe('MockProvider and registry', () => {
  it('produces a valid offline game plan without network access', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const provider = new MockProvider();
    const response = await provider.chat({
      purpose: 'game-plan',
      messages: [
        {
          role: 'user',
          content:
            '<description>Erstelle ein 3D-Horrorspiel in einem verlassenen Krankenhaus mit Schlüsseln, Türen und einem Monster.</description>',
        },
      ],
    });
    const plan = parseGamePlan(JSON.parse(response.text));
    expect(plan.dimension).toBe('3d');
    expect(plan.genre).toBe('Horror');
    expect(plan.features.map((f) => f.id)).toEqual(
      expect.arrayContaining(['keys_doors', 'enemy_ai', 'flashlight']),
    );
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(provider.capabilities.generative).toBe(false);
  });

  it('creates providers by id and explains missing configuration', () => {
    const registry = new ProviderRegistry();
    const base: AIConfig = {
      provider: null,
      anthropic: { model: 'claude-opus-5-5', effort: 'high', fallbacks: true },
      openai: { baseUrl: 'https://api.openai.com/v1', jsonMode: false },
      ollama: { baseUrl: 'http://localhost:11434' },
    };
    expect(() => registry.create(base)).toThrowError(/No AI provider is configured/);
    expect(registry.create({ ...base, provider: 'mock' }).id).toBe('mock');
    expect(() => registry.create({ ...base, provider: 'nope' })).toThrowError(
      /Unknown AI provider/,
    );
    expect(() => registry.create({ ...base, provider: 'ollama' })).toThrowError(
      /Ollama is not configured/,
    );
  });
});
