import { GameForgeError } from '../errors.js';

export interface HttpErrorContext {
  providerName: string;
  settingsHint: string;
  baseUrl: string;
  /** Extra hint when the server can't be reached (e.g. "Is Ollama running?"). */
  unreachableHint?: string;
}

/** POST/GET JSON with timeout, limited retries on 429/5xx and user-friendly errors. */
export async function requestJson<T>(
  url: string,
  init: {
    method?: 'GET' | 'POST';
    headers?: Record<string, string>;
    body?: unknown;
    signal?: AbortSignal;
    timeoutMs?: number;
  },
  context: HttpErrorContext,
): Promise<T> {
  const attempts = 3;
  let lastError: GameForgeError | null = null;
  for (let attempt = 0; attempt < attempts; attempt++) {
    const timeout = AbortSignal.timeout(init.timeoutMs ?? 300_000);
    const signal = init.signal ? AbortSignal.any([init.signal, timeout]) : timeout;
    let response: Response;
    try {
      response = await fetch(url, {
        method: init.method ?? 'POST',
        headers: { 'content-type': 'application/json', ...init.headers },
        ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
        signal,
      });
    } catch (error) {
      if (init.signal?.aborted) {
        throw new GameForgeError('CANCELLED', 'The AI request was cancelled.', { cause: error });
      }
      const timedOut = timeout.aborted;
      lastError = new GameForgeError('PROVIDER_UNREACHABLE', 'AI request failed.', {
        reason: timedOut
          ? `${context.providerName} did not answer in time.`
          : `Could not connect to ${context.providerName} at ${context.baseUrl}.`,
        solution: context.unreachableHint ?? `Check the base URL in ${context.settingsHint}.`,
        cause: error,
      });
      if (timedOut) throw lastError;
      await delay(500 * (attempt + 1));
      continue;
    }

    if (response.ok) {
      try {
        return (await response.json()) as T;
      } catch (error) {
        throw new GameForgeError('PROVIDER_BAD_RESPONSE', 'AI request failed.', {
          reason: `${context.providerName} returned a response that is not valid JSON.`,
          cause: error,
        });
      }
    }

    const bodyText = await response.text().catch(() => '');
    const detail = extractErrorMessage(bodyText);
    const status = response.status;
    if (status === 401 || status === 403) {
      throw new GameForgeError('INVALID_API_KEY', 'AI request failed.', {
        reason:
          status === 401
            ? 'Invalid API key.'
            : 'The API key is not allowed to perform this request.',
        solution: context.settingsHint,
        details: { status, detail },
      });
    }
    if (status === 404) {
      throw new GameForgeError('MODEL_NOT_FOUND', 'AI request failed.', {
        reason: detail || 'The model or endpoint was not found.',
        solution: `${context.settingsHint} and check the model name and base URL.`,
        details: { status },
      });
    }
    if (status === 429 || status >= 500) {
      lastError = new GameForgeError(
        status === 429 ? 'PROVIDER_RATE_LIMITED' : 'PROVIDER_OVERLOADED',
        'AI request failed.',
        {
          reason:
            detail ||
            (status === 429
              ? 'Rate limit reached.'
              : `${context.providerName} had a server error (${status}).`),
          solution: 'Wait a moment and try again.',
          details: { status },
        },
      );
      const retryAfter = Number(response.headers.get('retry-after'));
      await delay(
        Number.isFinite(retryAfter) && retryAfter > 0
          ? Math.min(retryAfter, 20) * 1000
          : 1000 * 2 ** attempt,
      );
      continue;
    }
    throw new GameForgeError('PROVIDER_REQUEST_FAILED', 'AI request failed.', {
      reason: detail || `${context.providerName} rejected the request (HTTP ${status}).`,
      solution: `${context.settingsHint} — check the configuration.`,
      details: { status },
    });
  }
  throw lastError ?? new GameForgeError('PROVIDER_REQUEST_FAILED', 'AI request failed.');
}

function extractErrorMessage(body: string): string {
  if (!body) return '';
  try {
    const parsed = JSON.parse(body) as { error?: { message?: string } | string; message?: string };
    if (typeof parsed.error === 'string') return parsed.error;
    return parsed.error?.message ?? parsed.message ?? body.slice(0, 300);
  } catch {
    return body.slice(0, 300);
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function joinUrl(base: string, path: string): string {
  return `${base.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`;
}
