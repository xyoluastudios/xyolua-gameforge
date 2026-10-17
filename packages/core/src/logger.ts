import { appendFileSync, mkdirSync, renameSync, statSync } from 'node:fs';
import { dirname } from 'node:path';
import { redactSecrets } from './secrets.js';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export interface LogEntry {
  time: string;
  level: LogLevel;
  scope: string;
  message: string;
  /** Debug details (stack traces, raw payloads). Only shown in logs. */
  details?: string;
}

export type LogSink = (entry: LogEntry) => void;

export interface Logger {
  debug(message: string, details?: unknown): void;
  info(message: string, details?: unknown): void;
  warn(message: string, details?: unknown): void;
  error(message: string, details?: unknown): void;
  child(scope: string): Logger;
}

function formatDetails(details: unknown): string | undefined {
  if (details === undefined) return undefined;
  if (details instanceof Error) {
    const cause = details.cause === undefined ? '' : `\nCaused by: ${formatDetails(details.cause)}`;
    return `${details.stack ?? details.message}${cause}`;
  }
  if (typeof details === 'string') return details;
  try {
    return JSON.stringify(details, null, 2);
  } catch {
    return String(details);
  }
}

/**
 * Small structured logger with pluggable sinks. All messages pass through
 * `redactSecrets` so API keys can't end up in logs or on screen.
 */
export class LogHub {
  private readonly sinks = new Set<LogSink>();
  private readonly buffer: LogEntry[] = [];
  level: LogLevel;

  constructor(
    level: LogLevel = 'info',
    private readonly bufferSize = 2000,
  ) {
    this.level = level;
  }

  addSink(sink: LogSink): () => void {
    this.sinks.add(sink);
    return () => this.sinks.delete(sink);
  }

  /** Recent entries (for the Logs panel). */
  recent(limit = 500): LogEntry[] {
    return this.buffer.slice(-limit);
  }

  write(level: LogLevel, scope: string, message: string, details?: unknown): void {
    const formatted = formatDetails(details);
    const entry: LogEntry = {
      time: new Date().toISOString(),
      level,
      scope,
      message: redactSecrets(message),
      ...(formatted ? { details: redactSecrets(formatted) } : {}),
    };
    this.buffer.push(entry);
    if (this.buffer.length > this.bufferSize)
      this.buffer.splice(0, this.buffer.length - this.bufferSize);
    if (LEVEL_ORDER[level] < LEVEL_ORDER[this.level]) return;
    for (const sink of this.sinks) {
      try {
        sink(entry);
      } catch {
        // A broken sink must never crash the app.
      }
    }
  }

  logger(scope = 'gameforge'): Logger {
    const make = (s: string): Logger => ({
      debug: (m, d) => this.write('debug', s, m, d),
      info: (m, d) => this.write('info', s, m, d),
      warn: (m, d) => this.write('warn', s, m, d),
      error: (m, d) => this.write('error', s, m, d),
      child: (child) => make(`${s}:${child}`),
    });
    return make(scope);
  }
}

/** Appends JSON lines to a file and rotates it at `maxBytes`. */
export function fileSink(path: string, maxBytes = 5 * 1024 * 1024): LogSink {
  mkdirSync(dirname(path), { recursive: true });
  return (entry) => {
    try {
      const size = statSync(path, { throwIfNoEntry: false })?.size ?? 0;
      if (size > maxBytes) {
        renameSync(path, `${path}.1`);
      }
    } catch {
      // ignore rotation errors
    }
    appendFileSync(path, `${JSON.stringify(entry)}\n`, 'utf8');
  };
}

/** A logger that drops everything. Useful as a default. */
export const silentLogger: Logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  child: () => silentLogger,
};
