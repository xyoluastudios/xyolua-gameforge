import { createInterface } from 'node:readline/promises';

/** Terminal I/O abstraction (makes the CLI testable). */
export interface CliIO {
  out(text: string): void;
  err(text: string): void;
  /** Asks a question; resolves to null when no interactive terminal is available. */
  ask(question: string): Promise<string | null>;
  interactive: boolean;
  color: boolean;
}

export function processIO(): CliIO {
  const interactive = !!process.stdin.isTTY && !!process.stdout.isTTY;
  return {
    out: (text) => process.stdout.write(`${text}\n`),
    err: (text) => process.stderr.write(`${text}\n`),
    interactive,
    color: !!process.stdout.isTTY && !process.env.NO_COLOR && process.env.TERM !== 'dumb',
    ask: async (question) => {
      if (!interactive) return null;
      const rl = createInterface({ input: process.stdin, output: process.stdout });
      try {
        return (await rl.question(question)).trim();
      } finally {
        rl.close();
      }
    },
  };
}

export function style(io: CliIO) {
  const wrap = (open: number, close: number) => (text: string) =>
    io.color ? `\u001b[${open}m${text}\u001b[${close}m` : text;
  return {
    bold: wrap(1, 22),
    dim: wrap(2, 22),
    red: wrap(31, 39),
    green: wrap(32, 39),
    yellow: wrap(33, 39),
    blue: wrap(34, 39),
    magenta: wrap(35, 39),
    cyan: wrap(36, 39),
    accent: wrap(33, 39),
  };
}
