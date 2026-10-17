import type {
  EventChannel,
  EventMap,
  GameForgeBridge,
  InvokeChannel,
  InvokeMap,
  UserFacingError,
} from '@shared/api';

declare global {
  interface Window {
    gameforge: GameForgeBridge;
  }
}

/** Error thrown in the renderer for failed backend calls (keeps reason / solution). */
export class ClientError extends Error {
  readonly code: string;
  readonly reason: string | undefined;
  readonly solution: string | undefined;

  constructor(error: UserFacingError) {
    super(error.message);
    this.code = error.code;
    this.reason = error.reason;
    this.solution = error.solution;
  }

  toJSON(): UserFacingError {
    return {
      code: this.code as UserFacingError['code'],
      message: this.message,
      ...(this.reason ? { reason: this.reason } : {}),
      ...(this.solution ? { solution: this.solution } : {}),
    };
  }
}

export async function call<C extends InvokeChannel>(
  channel: C,
  ...args: InvokeMap[C][0]
): Promise<InvokeMap[C][1]> {
  const result = await window.gameforge.invoke(channel, ...args);
  if (!result.ok) throw new ClientError(result.error);
  return result.value;
}

export function on<E extends EventChannel>(
  channel: E,
  listener: (payload: EventMap[E]) => void,
): () => void {
  return window.gameforge.on(channel, listener);
}

export function asUserError(error: unknown): UserFacingError {
  if (error instanceof ClientError) return error.toJSON();
  return {
    code: 'INTERNAL',
    message: 'Something went wrong.',
    reason: error instanceof Error ? error.message : String(error),
  };
}
