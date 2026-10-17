import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { GameForgeError } from '../errors.js';
import { redactSecrets, sanitizeEnv } from '../secrets.js';

/**
 * Splits a command line into argv without ever invoking a shell.
 * Shell operators (pipes, redirects, chaining, substitution) are rejected
 * instead of being interpreted.
 */
export function parseCommand(command: string): string[] {
  const args: string[] = [];
  let current = '';
  let quote: '"' | "'" | null = null;
  let hasToken = false;
  for (let i = 0; i < command.length; i++) {
    const ch = command[i]!;
    if (quote) {
      if (ch === quote) quote = null;
      else current += ch;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      hasToken = true;
      continue;
    }
    if (/\s/.test(ch)) {
      if (ch === '\n' || ch === '\r') throw shellSyntax('line breaks');
      if (hasToken) {
        args.push(current);
        current = '';
        hasToken = false;
      }
      continue;
    }
    if ('|&;<>`'.includes(ch)) throw shellSyntax(`"${ch}"`);
    if (ch === '$' && (command[i + 1] === '(' || command[i + 1] === '{')) throw shellSyntax('"$("');
    current += ch;
    hasToken = true;
  }
  if (quote) throw new GameForgeError('INVALID_INPUT', 'Unterminated quote in command.');
  if (hasToken) args.push(current);
  if (args.length === 0) throw new GameForgeError('INVALID_INPUT', 'Command is empty.');
  return args;
}

function shellSyntax(what: string): GameForgeError {
  return new GameForgeError('COMMAND_BLOCKED', `Shell syntax (${what}) is not allowed.`, {
    reason:
      'Commands run without a shell. Pipes, redirects and command chaining are disabled for safety.',
    solution: 'Run one program per command.',
  });
}

/** Display form of argv (quotes args with spaces). */
export function formatCommand(argv: string[]): string {
  return argv.map((a) => (/[\s"']/.test(a) ? JSON.stringify(a) : a)).join(' ');
}

export function programName(executable: string): string {
  return path
    .basename(executable)
    .toLowerCase()
    .replace(/\.(exe|cmd|bat|com)$/, '');
}

/** Finds an executable on PATH (honours PATHEXT on Windows). */
export function findExecutable(name: string, env: NodeJS.ProcessEnv = process.env): string | null {
  const isFile = (p: string) => {
    try {
      return statSync(p).isFile();
    } catch {
      return false;
    }
  };
  const exts =
    process.platform === 'win32'
      ? (env.PATHEXT ?? '.EXE;.CMD;.BAT;.COM').split(';').filter(Boolean)
      : [''];
  const candidates = (base: string) =>
    process.platform === 'win32' && path.extname(base) === ''
      ? [base, ...exts.map((e) => base + e.toLowerCase())]
      : [base];

  if (name.includes('/') || name.includes('\\')) {
    for (const candidate of candidates(name)) if (isFile(candidate)) return path.resolve(candidate);
    return null;
  }
  const dirs = (env.PATH ?? env.Path ?? '').split(path.delimiter).filter(Boolean);
  for (const dir of dirs) {
    for (const candidate of candidates(path.join(dir, name))) {
      // On Windows a bare name needs one of the PATHEXT extensions.
      if (
        process.platform === 'win32' &&
        path.extname(name) === '' &&
        candidate === path.join(dir, name)
      ) {
        continue;
      }
      if (isFile(candidate)) return candidate;
    }
  }
  return null;
}

export interface CommandResult {
  command: string;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  truncated: boolean;
  durationMs: number;
}

export interface RunOptions {
  cwd: string;
  timeoutMs?: number;
  /** Max bytes kept per stream. */
  maxOutputBytes?: number;
  /** Extra environment variables (merged into the sanitized environment). */
  env?: Record<string, string>;
  signal?: AbortSignal;
  onOutput?: (stream: 'stdout' | 'stderr', chunk: string) => void;
  stdin?: string;
}

const CMD_META = /[%!^&|<>"\r\n]/;

/** Spawns argv safely (no shell). Batch files on Windows go through cmd.exe with strict argument checks. */
export function spawnSafe(
  argv: string[],
  options: { cwd: string; env?: Record<string, string>; detached?: boolean },
): ChildProcess {
  const [program, ...args] = argv;
  if (!program) throw new GameForgeError('INVALID_INPUT', 'Command is empty.');
  const resolved = findExecutable(program) ?? (existsSync(program) ? program : null);
  if (!resolved) {
    throw new GameForgeError('COMMAND_NOT_FOUND', `Program not found: ${program}`, {
      solution: `Make sure "${program}" is installed and on your PATH.`,
    });
  }
  const env = sanitizeEnv(process.env, options.env);
  if (process.platform === 'win32' && /\.(cmd|bat)$/i.test(resolved)) {
    for (const arg of args) {
      if (CMD_META.test(arg)) {
        throw new GameForgeError(
          'COMMAND_BLOCKED',
          'Unsafe characters in arguments for a batch script.',
          {
            reason: `Argument ${JSON.stringify(arg)} contains characters cmd.exe would interpret.`,
          },
        );
      }
    }
    const line = [resolved, ...args].map((a) => (/\s/.test(a) ? `"${a}"` : a)).join(' ');
    return spawn(process.env.ComSpec ?? 'cmd.exe', ['/d', '/s', '/c', `"${line}"`], {
      cwd: options.cwd,
      env,
      windowsVerbatimArguments: true,
      windowsHide: true,
      detached: options.detached ?? false,
    });
  }
  return spawn(resolved, args, {
    cwd: options.cwd,
    env,
    shell: false,
    windowsHide: true,
    detached: options.detached ?? process.platform !== 'win32',
  });
}

/** Kills a process and its children. */
export function killTree(child: ChildProcess): void {
  if (child.pid === undefined || child.exitCode !== null) return;
  try {
    if (process.platform === 'win32') {
      spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], {
        windowsHide: true,
        stdio: 'ignore',
      });
    } else {
      try {
        process.kill(-child.pid, 'SIGKILL');
      } catch {
        child.kill('SIGKILL');
      }
    }
  } catch {
    // Process already gone.
  }
}

/**
 * Runs a command to completion with timeout and output limits.
 * Output is redacted for secrets before it is returned.
 */
export function runCommand(argv: string[], options: RunOptions): Promise<CommandResult> {
  const timeoutMs = options.timeoutMs ?? 120_000;
  const maxBytes = options.maxOutputBytes ?? 200_000;
  const started = Date.now();
  const command = formatCommand(argv);

  return new Promise<CommandResult>((resolve, reject) => {
    let child: ChildProcess;
    try {
      child = spawnSafe(argv, { cwd: options.cwd, ...(options.env ? { env: options.env } : {}) });
    } catch (error) {
      reject(error);
      return;
    }
    let stdout = '';
    let stderr = '';
    let truncated = false;
    let timedOut = false;
    let settled = false;

    const append = (stream: 'stdout' | 'stderr', chunk: Buffer) => {
      const text = chunk.toString('utf8');
      options.onOutput?.(stream, redactSecrets(text));
      const current = stream === 'stdout' ? stdout : stderr;
      if (current.length >= maxBytes) {
        truncated = true;
        return;
      }
      const next = (current + text).slice(0, maxBytes);
      if (next.length < current.length + text.length) truncated = true;
      if (stream === 'stdout') stdout = next;
      else stderr = next;
    };

    child.stdout?.on('data', (c: Buffer) => append('stdout', c));
    child.stderr?.on('data', (c: Buffer) => append('stderr', c));
    if (options.stdin !== undefined) child.stdin?.end(options.stdin);
    else child.stdin?.end();

    const timer = setTimeout(() => {
      timedOut = true;
      killTree(child);
    }, timeoutMs);
    const onAbort = () => killTree(child);
    options.signal?.addEventListener('abort', onAbort, { once: true });

    const finish = (exitCode: number | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', onAbort);
      if (options.signal?.aborted) {
        reject(new GameForgeError('CANCELLED', 'The command was cancelled.'));
        return;
      }
      resolve({
        command,
        exitCode,
        stdout: redactSecrets(stdout),
        stderr: redactSecrets(stderr),
        timedOut,
        truncated,
        durationMs: Date.now() - started,
      });
    };
    child.on('error', (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(
        new GameForgeError('COMMAND_FAILED', `Could not start: ${command}`, {
          reason: error.message,
          cause: error,
        }),
      );
    });
    child.on('close', (code) => finish(code));
  });
}
