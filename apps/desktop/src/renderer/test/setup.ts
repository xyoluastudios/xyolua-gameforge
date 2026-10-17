import { afterEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';
import type { GameForgeBridge } from '@shared/api';

/** Handlers for mocked backend channels (tests override per case). */
export const handlers: Record<string, (...args: unknown[]) => unknown> = {};
export const invoke = vi.fn(async (channel: string, ...args: unknown[]) => {
  const handler = handlers[channel];
  if (!handler) return { ok: true, value: null };
  try {
    return { ok: true, value: await handler(...args) };
  } catch (error) {
    return { ok: false, error: { code: 'INTERNAL', message: String(error) } };
  }
});

const bridge: GameForgeBridge = {
  invoke: invoke as unknown as GameForgeBridge['invoke'],
  on: () => () => {},
};
Object.defineProperty(window, 'gameforge', { value: bridge, writable: true });

afterEach(() => {
  cleanup();
  invoke.mockClear();
  for (const key of Object.keys(handlers)) delete handlers[key];
});
