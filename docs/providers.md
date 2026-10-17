# AI providers

GameForge never depends on one vendor. Agents talk to the `AIProvider` interface ([`packages/core/src/providers/types.ts`](../packages/core/src/providers/types.ts)); each provider translates to its own API.

```
AIProvider
├── AnthropicProvider          Claude via the Anthropic API (official SDK, streaming)
├── OpenAICompatibleProvider   any Chat Completions API
├── OllamaProvider             local models
└── MockProvider               offline, for development and tests
```

## Configuration

Settings are resolved in this order: **environment variables → settings file → defaults**. API keys come only from the environment (or a `.env` file for the CLI) or from the desktop app's encrypted key store — never from `settings.json`.

| Variable             | Meaning                                                                      |
| -------------------- | ---------------------------------------------------------------------------- |
| `AI_PROVIDER`        | `anthropic`, `openai-compatible`, `ollama`, `mock` (or a plugin provider id) |
| `ANTHROPIC_API_KEY`  | Your Anthropic key                                                           |
| `ANTHROPIC_MODEL`    | Default `claude-opus-5-5`                                                    |
| `ANTHROPIC_EFFORT`   | `default`, `low`, `medium`, `high` (default), `xhigh`, `max`                 |
| `ANTHROPIC_BASE_URL` | Optional (proxies, gateways)                                                 |
| `OPENAI_API_KEY`     | Key for the OpenAI-compatible server (optional for local servers)            |
| `OPENAI_BASE_URL`    | Default `https://api.openai.com/v1`                                          |
| `OPENAI_MODEL`       | Required model id                                                            |
| `OLLAMA_BASE_URL`    | Default `http://localhost:11434`                                             |
| `OLLAMA_MODEL`       | Required model name (see `ollama list`)                                      |

The CLI reads a `.env` file from the current folder (see [.env.example](../.env.example)). Never commit `.env` — it is in `.gitignore`, and `gameforge doctor` warns if git tracks it.

## Anthropic

- Uses the official `@anthropic-ai/sdk` with streaming, so long tool inputs (whole files) arrive as they are generated.
- Default model `claude-opus-5-5` with `effort: high`. Choose `default` to omit the effort parameter (for models that don't support it).
- **Refusal fallback** (on by default, Settings → AI Provider): requests carry `fallbacks: "default"` (beta `server-side-fallback-2026-07-01`), so a request declined by a safety classifier is retried server-side on Anthropic's recommended fallback model. Turn it off if you use a proxy that rejects beta headers.
- Errors are mapped to clear messages, e.g. an invalid key shows _"AI request failed. Reason: Invalid API key. Solution: Open Settings → AI Provider → Anthropic"_.

## OpenAI-compatible

Works with OpenAI, OpenRouter, Groq, Together, Mistral, LM Studio (`http://localhost:1234/v1`), vLLM, llama.cpp server and others. Tool calling is required for the code-writing agents. Enable **JSON schema response format** only if your server supports `response_format: json_schema`; plans are validated and retried either way.

## Ollama

Runs fully local — nothing leaves your machine. Pick a model with tool-calling support. Health checks tell you when Ollama is not running (`ollama serve`) or the model is not pulled (`ollama pull <model>`).

## Mock

`AI_PROVIDER=mock` is clearly labeled _offline, no AI_. It returns plans from a deterministic keyword planner and answers agent requests with an explanation that no AI is configured. All games are still built from the tested templates, validated and tested. Unit tests use the mock in **scripted** mode to replay exact model responses.

## Adding a provider

Implement `AIProvider` (`chat`, `healthCheck`, `capabilities`) and register a factory from a plugin:

```ts
ctx.registerProvider({
  id: 'my-provider',
  displayName: 'My Provider',
  description: 'Calls my model server',
  create: (config) => new MyProvider(config),
});
```

Then set `AI_PROVIDER=my-provider`.
