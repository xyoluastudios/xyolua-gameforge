import { existsSync, realpathSync, statSync } from 'node:fs';
import { mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { GameForgeError } from '../errors.js';
import { ChangeSet, type FileChange } from './changeset.js';
import { protectionFor, resolveInside, toPosix } from './path-guard.js';

export type WorkspacePolicy =
  /** AI agents, MCP clients: secrets and internal folders are protected. */
  | 'agent'
  /** The human user in the editor: only the project boundary is enforced. */
  | 'user';

export interface WorkspaceOptions {
  policy?: WorkspacePolicy;
  maxReadBytes?: number;
  maxWriteBytes?: number;
}

export interface FileEntry {
  path: string;
  type: 'file' | 'directory';
  size?: number;
}

/** Folders that are never listed or searched (caches, VCS internals). */
export const IGNORED_DIRS = new Set(['.git', '.godot', '.import', 'node_modules', '.gameforge']);

const DEFAULT_MAX_READ = 1024 * 1024; // 1 MiB
const DEFAULT_MAX_WRITE = 2 * 1024 * 1024; // 2 MiB

function isBinary(buffer: Buffer): boolean {
  const sample = buffer.subarray(0, 8000);
  return sample.includes(0);
}

/**
 * Sandboxed view of a project folder. All agent file access goes through this
 * class: paths are confined to the project root (symlinks included), secret
 * files are blocked and every write is recorded in a `ChangeSet`.
 */
export class Workspace {
  readonly root: string;
  readonly policy: WorkspacePolicy;
  private readonly maxRead: number;
  private readonly maxWrite: number;
  /** Shared between all policy views of the same workspace. */
  private readonly shared: { changeSet: ChangeSet | null };

  private constructor(
    root: string,
    options: WorkspaceOptions,
    shared: { changeSet: ChangeSet | null } = { changeSet: null },
  ) {
    this.shared = shared;
    this.root = root;
    this.policy = options.policy ?? 'agent';
    this.maxRead = options.maxReadBytes ?? DEFAULT_MAX_READ;
    this.maxWrite = options.maxWriteBytes ?? DEFAULT_MAX_WRITE;
  }

  static open(root: string, options: WorkspaceOptions = {}): Workspace {
    const absolute = path.resolve(root);
    if (!existsSync(absolute) || !statSync(absolute).isDirectory()) {
      throw new GameForgeError('PROJECT_NOT_FOUND', 'Project folder not found.', {
        reason: `"${absolute}" does not exist or is not a folder.`,
        solution: 'Choose an existing project folder.',
      });
    }
    return new Workspace(realpathSync.native(absolute), options);
  }

  /** Returns a second view on the same folder with a different policy. */
  withPolicy(policy: WorkspacePolicy): Workspace {
    return new Workspace(
      this.root,
      { policy, maxReadBytes: this.maxRead, maxWriteBytes: this.maxWrite },
      this.shared,
    );
  }

  // ---------------------------------------------------------------- paths

  /** Resolves and validates a path. Returns absolute + workspace-relative POSIX path. */
  resolve(input: string, options: { forWrite?: boolean } = {}): { abs: string; rel: string } {
    const abs = resolveInside(this.root, input);
    const rel = toPosix(path.relative(this.root, abs));
    if (this.policy === 'agent') {
      const protection = protectionFor(rel, options.forWrite ?? false);
      if (protection === 'secret') {
        throw new GameForgeError('PATH_PROTECTED', `Access to "${rel}" is blocked.`, {
          reason: 'This file may contain secrets (API keys, passwords or private keys).',
          solution:
            'GameForge never lets agents read or modify secret files. Edit it yourself if needed.',
          details: { path: rel },
        });
      }
      if (protection === 'read-only') {
        throw new GameForgeError('PATH_PROTECTED', `"${rel}" is read-only for agents.`, {
          reason:
            'Internal folders (.git, .godot, .gameforge, node_modules) are managed by tools, not by agents.',
          details: { path: rel },
        });
      }
    }
    return { abs, rel };
  }

  relative(abs: string): string {
    return toPosix(path.relative(this.root, abs));
  }

  // ------------------------------------------------------------- changes

  get changes(): ChangeSet | null {
    return this.shared.changeSet;
  }

  private get changeSet(): ChangeSet | null {
    return this.shared.changeSet;
  }

  private set changeSet(value: ChangeSet | null) {
    this.shared.changeSet = value;
  }

  /** Starts recording changes. In `staged` mode nothing is written to disk. */
  beginChanges(mode: 'staged' | 'direct'): ChangeSet {
    if (this.changeSet && this.changeSet.size > 0) {
      throw new GameForgeError('INVALID_INPUT', 'There are unreviewed changes.', {
        solution: 'Apply or discard the pending changes first.',
      });
    }
    this.changeSet = new ChangeSet(mode);
    return this.changeSet;
  }

  /** Writes staged changes to disk (no-op for direct mode) and stops tracking. */
  async applyChanges(paths?: string[]): Promise<FileChange[]> {
    const set = this.changeSet;
    if (!set) return [];
    const selected = set.list().filter((c) => !paths || paths.includes(c.path));
    if (set.mode === 'staged') {
      for (const change of selected) {
        const abs = resolveInside(this.root, change.path);
        if (change.after === null) {
          await rm(abs, { force: true });
        } else {
          await mkdir(path.dirname(abs), { recursive: true });
          await writeFile(abs, change.after, 'utf8');
        }
      }
    }
    for (const change of selected) set.forget(change.path);
    if (set.size === 0) this.changeSet = null;
    return selected;
  }

  /** Throws away staged changes, or restores originals for direct mode. */
  async discardChanges(paths?: string[]): Promise<FileChange[]> {
    const set = this.changeSet;
    if (!set) return [];
    const selected = set.list().filter((c) => !paths || paths.includes(c.path));
    if (set.mode === 'direct') {
      for (const change of selected) {
        const abs = resolveInside(this.root, change.path);
        if (change.before === null) await rm(abs, { force: true });
        else {
          await mkdir(path.dirname(abs), { recursive: true });
          await writeFile(abs, change.before, 'utf8');
        }
      }
    }
    for (const change of selected) set.forget(change.path);
    if (set.size === 0) this.changeSet = null;
    return selected;
  }

  // ------------------------------------------------------------ reading

  async exists(input: string): Promise<boolean> {
    const { abs, rel } = this.resolve(input);
    const staged = this.stagedState(rel);
    if (staged !== undefined) return staged !== null;
    return existsSync(abs);
  }

  async isDirectory(input: string): Promise<boolean> {
    const { abs } = this.resolve(input);
    const info = await stat(abs).catch(() => null);
    return info?.isDirectory() ?? false;
  }

  async readText(input: string): Promise<string> {
    const { abs, rel } = this.resolve(input);
    const staged = this.stagedState(rel);
    if (staged === null) throw this.notFound(rel);
    if (typeof staged === 'string') return staged;
    const info = await stat(abs).catch(() => null);
    if (!info || !info.isFile()) throw this.notFound(rel);
    if (info.size > this.maxRead) {
      throw new GameForgeError('FILE_TOO_LARGE', `"${rel}" is too large to read.`, {
        reason: `The file has ${info.size} bytes; the limit is ${this.maxRead}.`,
      });
    }
    const buffer = await readFile(abs);
    if (isBinary(buffer)) {
      throw new GameForgeError('INVALID_INPUT', `"${rel}" is a binary file.`, {
        reason: 'Only text files can be read by agents.',
      });
    }
    return buffer.toString('utf8');
  }

  /** Reads a text file, returning `null` when it does not exist. */
  async readTextOrNull(input: string): Promise<string | null> {
    try {
      return await this.readText(input);
    } catch (error) {
      if (error instanceof GameForgeError && error.code === 'FILE_NOT_FOUND') return null;
      throw error;
    }
  }

  /** Lists files and folders (staged creations/deletions included). */
  async list(
    dir = '.',
    options: { recursive?: boolean; maxEntries?: number; includeIgnored?: boolean } = {},
  ): Promise<FileEntry[]> {
    const { abs } = this.resolve(dir);
    const max = options.maxEntries ?? 5000;
    const results: FileEntry[] = [];
    const walk = async (current: string): Promise<void> => {
      const entries = await readdir(current, { withFileTypes: true }).catch(() => []);
      entries.sort((a, b) => a.name.localeCompare(b.name));
      for (const entry of entries) {
        if (results.length >= max) return;
        const full = path.join(current, entry.name);
        const rel = this.relative(full);
        if (entry.isDirectory()) {
          if (!options.includeIgnored && IGNORED_DIRS.has(entry.name)) continue;
          results.push({ path: rel, type: 'directory' });
          if (options.recursive) await walk(full);
        } else if (entry.isFile()) {
          if (this.policy === 'agent' && protectionFor(rel, false) === 'secret') continue;
          if (this.stagedState(rel) === null) continue;
          const info = await stat(full).catch(() => null);
          results.push({ path: rel, type: 'file', ...(info ? { size: info.size } : {}) });
        }
      }
    };
    await walk(abs);
    // Staged files that don't exist on disk yet.
    const prefix = this.relative(abs);
    for (const change of this.changeSet?.list() ?? []) {
      if (change.after === null || results.some((r) => r.path === change.path)) continue;
      const inDir = prefix === '' || change.path.startsWith(`${prefix}/`);
      const direct = !change.path.slice(prefix === '' ? 0 : prefix.length + 1).includes('/');
      if (inDir && (options.recursive || direct)) {
        results.push({ path: change.path, type: 'file', size: Buffer.byteLength(change.after) });
      }
    }
    return results;
  }

  /** All files (recursive), optionally filtered by extension (e.g. `.gd`). */
  async files(extensions?: string[]): Promise<string[]> {
    const entries = await this.list('.', { recursive: true, maxEntries: 20000 });
    return entries
      .filter((e) => e.type === 'file')
      .map((e) => e.path)
      .filter((p) => !extensions || extensions.includes(path.extname(p).toLowerCase()));
  }

  // ------------------------------------------------------------ writing

  async writeText(input: string, content: string, author = 'user'): Promise<{ created: boolean }> {
    const { abs, rel } = this.resolve(input, { forWrite: true });
    const bytes = Buffer.byteLength(content, 'utf8');
    if (bytes > this.maxWrite) {
      throw new GameForgeError('FILE_TOO_LARGE', `Refusing to write ${bytes} bytes to "${rel}".`, {
        reason: `The limit for a single file is ${this.maxWrite} bytes.`,
      });
    }
    if (await this.isDirectory(rel)) {
      throw new GameForgeError('INVALID_INPUT', `"${rel}" is a directory.`);
    }
    const before = await this.currentContent(rel, abs);
    if (this.changeSet) this.changeSet.record(rel, before, content, author);
    if (!this.changeSet || this.changeSet.mode === 'direct') {
      await mkdir(path.dirname(abs), { recursive: true });
      await writeFile(abs, content, 'utf8');
    }
    return { created: before === null };
  }

  async deleteFile(input: string, author = 'user'): Promise<void> {
    const { abs, rel } = this.resolve(input, { forWrite: true });
    const before = await this.currentContent(rel, abs);
    if (before === null) throw this.notFound(rel);
    if (this.changeSet) this.changeSet.record(rel, before, null, author);
    if (!this.changeSet || this.changeSet.mode === 'direct') await rm(abs, { force: true });
  }

  async mkdir(input: string): Promise<void> {
    const { abs } = this.resolve(input, { forWrite: true });
    await mkdir(abs, { recursive: true });
  }

  // ------------------------------------------------------------ helpers

  /** `undefined` = no staged state, `null` = staged delete, string = staged content. */
  private stagedState(rel: string): string | null | undefined {
    const set = this.changeSet;
    if (!set || set.mode !== 'staged') return undefined;
    const change = set.get(rel);
    return change ? change.after : undefined;
  }

  private async currentContent(rel: string, abs: string): Promise<string | null> {
    const staged = this.stagedState(rel);
    if (staged !== undefined) return staged;
    const info = await stat(abs).catch(() => null);
    if (!info || !info.isFile()) return null;
    const buffer = await readFile(abs);
    // Binary originals can't be diffed — represent them by a marker.
    return isBinary(buffer) ? `[binary file, ${buffer.length} bytes]` : buffer.toString('utf8');
  }

  private notFound(rel: string): GameForgeError {
    return new GameForgeError('FILE_NOT_FOUND', `File not found: ${rel}`, {
      details: { path: rel },
    });
  }
}
