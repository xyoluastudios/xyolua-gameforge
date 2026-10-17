/**
 * User-facing error model.
 *
 * Every error that can reach a user (UI, CLI, MCP) is converted into a
 * `GameForgeError` with a short message, an optional reason and an actionable
 * solution. Stack traces and raw causes only ever go to the log file.
 */

export type ErrorCode =
  | 'INVALID_API_KEY'
  | 'PROVIDER_NOT_CONFIGURED'
  | 'PROVIDER_UNREACHABLE'
  | 'PROVIDER_RATE_LIMITED'
  | 'PROVIDER_OVERLOADED'
  | 'PROVIDER_BAD_RESPONSE'
  | 'PROVIDER_REQUEST_FAILED'
  | 'MODEL_NOT_FOUND'
  | 'PATH_OUTSIDE_WORKSPACE'
  | 'PATH_PROTECTED'
  | 'FILE_NOT_FOUND'
  | 'FILE_TOO_LARGE'
  | 'FILE_EXISTS'
  | 'EDIT_NO_MATCH'
  | 'EDIT_AMBIGUOUS'
  | 'COMMAND_BLOCKED'
  | 'COMMAND_DENIED'
  | 'COMMAND_FAILED'
  | 'COMMAND_TIMEOUT'
  | 'COMMAND_NOT_FOUND'
  | 'PERMISSION_DENIED'
  | 'INVALID_INPUT'
  | 'UNKNOWN_TOOL'
  | 'ENGINE_NOT_FOUND'
  | 'ENGINE_NOT_SUPPORTED'
  | 'PROJECT_NOT_FOUND'
  | 'PROJECT_INVALID'
  | 'PLAN_INVALID'
  | 'GIT_NOT_AVAILABLE'
  | 'GIT_FAILED'
  | 'PLUGIN_FAILED'
  | 'CANCELLED'
  | 'INTERNAL';

export interface GameForgeErrorOptions {
  /** Why it happened, in plain language. */
  reason?: string;
  /** What the user can do about it. */
  solution?: string;
  /** Underlying error — logged, never shown to normal users. */
  cause?: unknown;
  /** Extra structured data for logs / programmatic consumers. */
  details?: Record<string, unknown>;
}

export class GameForgeError extends Error {
  readonly code: ErrorCode;
  readonly reason: string | undefined;
  readonly solution: string | undefined;
  readonly details: Record<string, unknown> | undefined;

  constructor(code: ErrorCode, message: string, options: GameForgeErrorOptions = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'GameForgeError';
    this.code = code;
    this.reason = options.reason;
    this.solution = options.solution;
    this.details = options.details;
  }

  /** Serializable shape for IPC / JSON-RPC. Never includes stack traces. */
  toJSON(): UserFacingError {
    return {
      code: this.code,
      message: this.message,
      ...(this.reason ? { reason: this.reason } : {}),
      ...(this.solution ? { solution: this.solution } : {}),
    };
  }
}

export interface UserFacingError {
  code: ErrorCode;
  message: string;
  reason?: string;
  solution?: string;
}

export function isGameForgeError(value: unknown): value is GameForgeError {
  return value instanceof GameForgeError;
}

/** Converts anything thrown into a safe, user-facing error. */
export function toUserError(error: unknown): UserFacingError {
  if (isGameForgeError(error)) return error.toJSON();
  if (error instanceof Error && error.name === 'AbortError') {
    return { code: 'CANCELLED', message: 'The operation was cancelled.' };
  }
  return {
    code: 'INTERNAL',
    message: 'Something went wrong.',
    reason: error instanceof Error ? error.message : String(error),
    solution: 'Check the Logs panel for details. If this keeps happening, please open an issue.',
  };
}

/** Renders an error the way the CLI and log panel show it. */
export function formatUserError(error: UserFacingError): string {
  const lines = [error.message];
  if (error.reason) lines.push('', 'Reason:', error.reason);
  if (error.solution) lines.push('', 'Solution:', error.solution);
  return lines.join('\n');
}

export function cancelledError(): GameForgeError {
  return new GameForgeError('CANCELLED', 'The operation was cancelled.');
}

export function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw cancelledError();
}
