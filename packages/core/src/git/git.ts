import { existsSync } from 'node:fs';
import path from 'node:path';
import { GameForgeError } from '../errors.js';
import { findExecutable, runCommand, type CommandResult } from '../process/command.js';

export interface GitFileStatus {
  path: string;
  /** Two-letter porcelain code, e.g. " M", "A ", "??". */
  code: string;
  staged: boolean;
  unstaged: boolean;
  untracked: boolean;
  kind: 'modified' | 'added' | 'deleted' | 'renamed' | 'untracked' | 'conflict' | 'other';
}

export interface GitStatus {
  isRepo: boolean;
  branch: string | null;
  upstream: string | null;
  ahead: number;
  behind: number;
  files: GitFileStatus[];
}

export interface GitCommit {
  hash: string;
  shortHash: string;
  author: string;
  date: string;
  subject: string;
}

const BRANCH_NAME =
  /^(?!-)(?!.*\.\.)(?!.*\/\/)(?!.*@\{)[A-Za-z0-9._/-]{1,100}(?<!\.lock)(?<![/.])$/;

export function parsePorcelain(output: string): Omit<GitStatus, 'isRepo'> {
  const entries = output.split('\0').filter(Boolean);
  let branch: string | null = null;
  let upstream: string | null = null;
  let ahead = 0;
  let behind = 0;
  const files: GitFileStatus[] = [];
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i]!;
    if (entry.startsWith('## ')) {
      const header = entry.slice(3);
      const noCommits = /^No commits yet on (.+)$/.exec(header);
      if (noCommits) {
        branch = noCommits[1]!;
        continue;
      }
      const match = /^([^.\s]+(?:\.(?!\.)[^.\s]+)*)(?:\.\.\.(\S+))?(?: \[(.+)\])?/.exec(header);
      branch = match?.[1] ?? header;
      upstream = match?.[2] ?? null;
      const info = match?.[3] ?? '';
      ahead = Number(/ahead (\d+)/.exec(info)?.[1] ?? 0);
      behind = Number(/behind (\d+)/.exec(info)?.[1] ?? 0);
      if (branch === 'HEAD (no branch)') branch = null;
      continue;
    }
    const code = entry.slice(0, 2);
    const file = entry.slice(3);
    if (code[0] === 'R' || code[0] === 'C') i++; // next entry is the original path
    const x = code[0]!;
    const y = code[1]!;
    const untracked = code === '??';
    const conflict = x === 'U' || y === 'U' || code === 'AA' || code === 'DD';
    let kind: GitFileStatus['kind'] = 'other';
    if (untracked) kind = 'untracked';
    else if (conflict) kind = 'conflict';
    else if (x === 'R' || y === 'R') kind = 'renamed';
    else if (x === 'A' || y === 'A') kind = 'added';
    else if (x === 'D' || y === 'D') kind = 'deleted';
    else if (x === 'M' || y === 'M') kind = 'modified';
    files.push({
      path: file,
      code,
      staged: !untracked && x !== ' ',
      unstaged: !untracked && y !== ' ',
      untracked,
      kind,
    });
  }
  return { branch, upstream, ahead, behind, files };
}

/**
 * Thin wrapper over the git CLI (no shell). Pushing exists only as an explicit
 * user action — it is never exposed as an agent tool.
 */
export class GitService {
  constructor(private readonly timeoutMs = 30_000) {}

  isAvailable(): boolean {
    return findExecutable('git') !== null;
  }

  private async git(root: string, args: string[], allowFailure = false): Promise<CommandResult> {
    if (!this.isAvailable()) {
      throw new GameForgeError('GIT_NOT_AVAILABLE', 'Git is not installed.', {
        solution: 'Install Git from https://git-scm.com and restart GameForge.',
      });
    }
    const result = await runCommand(
      ['git', '-c', 'core.quotepath=false', '-c', 'color.ui=false', ...args],
      {
        cwd: root,
        timeoutMs: this.timeoutMs,
        maxOutputBytes: 2_000_000,
        env: { GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0' },
      },
    );
    if (!allowFailure && result.exitCode !== 0) {
      throw new GameForgeError('GIT_FAILED', `git ${args[0]} failed.`, {
        reason: (result.stderr || result.stdout).trim().split('\n').slice(-3).join('\n'),
      });
    }
    return result;
  }

  async isRepo(root: string): Promise<boolean> {
    if (!this.isAvailable()) return false;
    const result = await this.git(root, ['rev-parse', '--is-inside-work-tree'], true);
    return result.exitCode === 0 && result.stdout.trim() === 'true';
  }

  async init(root: string): Promise<void> {
    await this.git(root, ['init', '-b', 'main']);
  }

  async status(root: string): Promise<GitStatus> {
    if (!(await this.isRepo(root))) {
      return { isRepo: false, branch: null, upstream: null, ahead: 0, behind: 0, files: [] };
    }
    const result = await this.git(root, [
      'status',
      '--porcelain=v1',
      '-z',
      '--branch',
      '--untracked-files=all',
    ]);
    return { isRepo: true, ...parsePorcelain(result.stdout) };
  }

  async diff(root: string, options: { path?: string; staged?: boolean } = {}): Promise<string> {
    const args = ['diff', '--no-ext-diff'];
    if (options.staged) args.push('--cached');
    if (options.path) args.push('--', options.path);
    const result = await this.git(root, args);
    // Untracked files have no diff — show them as new files.
    if (!options.staged && options.path) {
      const status = await this.status(root);
      const entry = status.files.find((f) => f.path === options.path);
      if (entry?.untracked && !result.stdout) {
        const shown = await this.git(
          root,
          ['diff', '--no-index', '--', devNull(), options.path],
          true,
        );
        return shown.stdout;
      }
    }
    return result.stdout;
  }

  async log(root: string, limit = 50): Promise<GitCommit[]> {
    const result = await this.git(
      root,
      [
        'log',
        `-n${Math.min(Math.max(limit, 1), 500)}`,
        '--pretty=format:%H%x1f%h%x1f%an%x1f%aI%x1f%s%x1e',
      ],
      true,
    );
    if (result.exitCode !== 0) return []; // no commits yet
    return result.stdout
      .split('\x1e')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const [hash = '', shortHash = '', author = '', date = '', subject = ''] =
          line.split('\x1f');
        return { hash, shortHash, author, date, subject };
      });
  }

  async branches(root: string): Promise<{ current: string | null; all: string[] }> {
    const result = await this.git(root, ['branch', '--format=%(refname:short)%09%(HEAD)'], true);
    const all: string[] = [];
    let current: string | null = null;
    for (const line of result.stdout.split('\n').filter(Boolean)) {
      const [name = '', head] = line.split('\t');
      all.push(name);
      if (head === '*') current = name;
    }
    if (!current) current = (await this.status(root)).branch;
    return { current, all };
  }

  async commit(root: string, message: string, paths?: string[]): Promise<string> {
    const subject = message.trim();
    if (!subject) throw new GameForgeError('INVALID_INPUT', 'A commit message is required.');
    if (paths && paths.length) await this.git(root, ['add', '--', ...paths]);
    else await this.git(root, ['add', '-A']);
    const result = await this.git(root, ['commit', '-m', subject], true);
    if (result.exitCode !== 0) {
      const output = `${result.stderr}\n${result.stdout}`;
      if (/Please tell me who you are|user\.email/i.test(output)) {
        throw new GameForgeError('GIT_FAILED', 'Git does not know who you are.', {
          reason: 'No user name / email is configured for commits.',
          solution:
            'Run: git config --global user.name "Your Name" and git config --global user.email "you@example.com"',
        });
      }
      if (/nothing to commit/i.test(output)) {
        throw new GameForgeError('GIT_FAILED', 'Nothing to commit.');
      }
      throw new GameForgeError('GIT_FAILED', 'Commit failed.', {
        reason: output.trim().split('\n').slice(-3).join('\n'),
      });
    }
    const head = await this.git(root, ['rev-parse', '--short', 'HEAD']);
    return head.stdout.trim();
  }

  async createBranch(root: string, name: string, checkout = true): Promise<void> {
    if (!BRANCH_NAME.test(name)) {
      throw new GameForgeError('INVALID_INPUT', `"${name}" is not a valid branch name.`);
    }
    await this.git(root, checkout ? ['checkout', '-b', name] : ['branch', name]);
  }

  async checkout(root: string, name: string): Promise<void> {
    if (!BRANCH_NAME.test(name))
      throw new GameForgeError('INVALID_INPUT', `"${name}" is not a valid branch name.`);
    await this.git(root, ['checkout', name]);
  }

  /** Discards local modifications of tracked files (untracked files are left alone). */
  async discard(root: string, paths: string[]): Promise<void> {
    if (paths.length === 0) return;
    for (const p of paths) {
      if (p.startsWith('-') || path.isAbsolute(p) || p.split(/[\\/]/).includes('..')) {
        throw new GameForgeError('INVALID_INPUT', `Invalid path: ${p}`);
      }
    }
    await this.git(root, ['restore', '--staged', '--worktree', '--', ...paths]);
  }

  /** Explicit user action only — never called by agents. */
  async push(root: string): Promise<string> {
    const result = await this.git(root, ['push'], true);
    if (result.exitCode !== 0) {
      throw new GameForgeError('GIT_FAILED', 'Push failed.', {
        reason: (result.stderr || result.stdout).trim().split('\n').slice(-4).join('\n'),
        solution: 'Check that a remote is configured and that you are signed in to it.',
      });
    }
    return (result.stderr || result.stdout).trim();
  }

  hasGitDir(root: string): boolean {
    return existsSync(path.join(root, '.git'));
  }
}

/** Git (also Git for Windows) understands /dev/null for --no-index diffs. */
function devNull(): string {
  return '/dev/null';
}
