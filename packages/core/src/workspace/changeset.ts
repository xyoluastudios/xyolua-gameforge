import { diffStats, unifiedDiff } from './diff.js';

export type ChangeKind = 'create' | 'modify' | 'delete';

export interface FileChange {
  /** Workspace-relative POSIX path. */
  path: string;
  kind: ChangeKind;
  /** Content before the change (`null` = file did not exist). */
  before: string | null;
  /** Content after the change (`null` = file deleted). */
  after: string | null;
  /** Which agent / actor made the change. */
  author: string;
}

export interface ChangeSummary {
  path: string;
  kind: ChangeKind;
  additions: number;
  deletions: number;
  author: string;
}

/**
 * Tracks every file change made by agents.
 *
 * - `staged` mode: changes live only in memory. Reads through the workspace see
 *   them, the disk is untouched until `Workspace.applyChanges()`.
 * - `direct` mode: changes are written immediately, but the original content is
 *   kept so the whole set can be reviewed and reverted.
 */
export class ChangeSet {
  private readonly changes = new Map<string, FileChange>();

  constructor(readonly mode: 'staged' | 'direct') {}

  get(path: string): FileChange | undefined {
    return this.changes.get(path);
  }

  has(path: string): boolean {
    return this.changes.has(path);
  }

  get size(): number {
    return this.changes.size;
  }

  /** Records a change. Consecutive edits of a file are merged into one entry. */
  record(path: string, before: string | null, after: string | null, author: string): void {
    const existing = this.changes.get(path);
    const original = existing ? existing.before : before;
    if (original === after) {
      // Changed back to the original content — nothing left to review.
      this.changes.delete(path);
      return;
    }
    const kind: ChangeKind = original === null ? 'create' : after === null ? 'delete' : 'modify';
    this.changes.set(path, {
      path,
      kind,
      before: original,
      after,
      author: existing?.author ?? author,
    });
  }

  forget(path: string): void {
    this.changes.delete(path);
  }

  list(): FileChange[] {
    return [...this.changes.values()].sort((a, b) => a.path.localeCompare(b.path));
  }

  summary(): ChangeSummary[] {
    return this.list().map((c) => ({
      path: c.path,
      kind: c.kind,
      author: c.author,
      ...diffStats(c.before ?? '', c.after ?? ''),
    }));
  }

  diff(path?: string): string {
    const items = path ? [this.changes.get(path)].filter((c): c is FileChange => !!c) : this.list();
    return items
      .map((c) => unifiedDiff(c.path, c.before, c.after))
      .filter(Boolean)
      .join('\n');
  }

  clear(): void {
    this.changes.clear();
  }
}
