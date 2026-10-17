import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { diffLines, diffStats, unifiedDiff } from '../src/workspace/diff.js';
import { Workspace } from '../src/workspace/workspace.js';
import { tempDir, writeFiles } from './helpers.js';

describe('diff', () => {
  it('computes a minimal line diff', () => {
    const ops = diffLines('a\nb\nc\n', 'a\nB\nc\nd\n');
    expect(ops.map((o) => `${o.type[0]}${o.line}`)).toEqual(['ea', 'db', 'iB', 'ec', 'id']);
    expect(diffStats('a\nb\nc\n', 'a\nB\nc\nd\n')).toEqual({ additions: 2, deletions: 1 });
  });

  it('renders unified diffs for new, changed and deleted files', () => {
    expect(unifiedDiff('new.gd', null, 'extends Node\n')).toContain(
      '--- /dev/null\n+++ b/new.gd\n@@ -0,0 +1,1 @@\n+extends Node',
    );
    const changed = unifiedDiff('p.gd', 'x\ny\nz\n', 'x\nY\nz\n');
    expect(changed).toContain('@@ -1,3 +1,3 @@');
    expect(changed).toContain('-y\n+Y');
    expect(unifiedDiff('gone.gd', 'a\n', null)).toContain('+++ /dev/null');
    expect(unifiedDiff('same.gd', 'a\n', 'a\n')).toBe('');
  });

  it('splits distant changes into separate hunks', () => {
    const before = Array.from({ length: 30 }, (_, i) => `line ${i}`).join('\n');
    const after = before.replace('line 2', 'LINE 2').replace('line 25', 'LINE 25');
    expect(unifiedDiff('f', before, after).match(/^@@/gm)).toHaveLength(2);
  });
});

describe('staged changes', () => {
  it('keeps the disk untouched until applied, but reads see staged content', async () => {
    const root = tempDir();
    writeFiles(root, { 'player.gd': 'var speed = 5\n', 'old.gd': 'x\n' });
    const ws = Workspace.open(root);
    ws.beginChanges('staged');
    await ws.writeText('player.gd', 'var speed = 8\n', 'Programmer');
    await ws.writeText('enemy.gd', 'extends Node\n', 'Programmer');
    await ws.deleteFile('old.gd', 'Programmer');

    expect(readFileSync(path.join(root, 'player.gd'), 'utf8')).toBe('var speed = 5\n');
    expect(existsSync(path.join(root, 'enemy.gd'))).toBe(false);
    expect(await ws.readText('player.gd')).toBe('var speed = 8\n');
    expect(await ws.exists('old.gd')).toBe(false);
    const files = await ws.files();
    expect(files).toContain('enemy.gd');
    expect(files).not.toContain('old.gd');

    const summary = ws.changes!.summary();
    expect(summary.map((c) => `${c.kind}:${c.path}`)).toEqual([
      'create:enemy.gd',
      'delete:old.gd',
      'modify:player.gd',
    ]);
    expect(ws.changes!.diff('player.gd')).toContain('+var speed = 8');

    await ws.applyChanges(['player.gd', 'enemy.gd']);
    expect(readFileSync(path.join(root, 'player.gd'), 'utf8')).toBe('var speed = 8\n');
    expect(existsSync(path.join(root, 'enemy.gd'))).toBe(true);
    expect(existsSync(path.join(root, 'old.gd'))).toBe(true); // not applied yet
    await ws.discardChanges();
    expect(ws.changes).toBeNull();
    expect(existsSync(path.join(root, 'old.gd'))).toBe(true);
  });

  it('direct mode writes immediately and can be reverted', async () => {
    const root = tempDir();
    writeFiles(root, { 'a.gd': 'A\n' });
    const ws = Workspace.open(root);
    ws.beginChanges('direct');
    await ws.writeText('a.gd', 'B\n', 'Programmer');
    await ws.writeText('b.gd', 'new\n', 'Programmer');
    expect(readFileSync(path.join(root, 'a.gd'), 'utf8')).toBe('B\n');
    await ws.discardChanges();
    expect(readFileSync(path.join(root, 'a.gd'), 'utf8')).toBe('A\n');
    expect(existsSync(path.join(root, 'b.gd'))).toBe(false);
  });

  it('merges repeated edits and drops changes that return to the original', async () => {
    const root = tempDir();
    writeFiles(root, { 'a.gd': 'A\n' });
    const ws = Workspace.open(root);
    ws.beginChanges('staged');
    await ws.writeText('a.gd', 'B\n', 'Programmer');
    await ws.writeText('a.gd', 'C\n', 'QA');
    expect(ws.changes!.get('a.gd')).toMatchObject({
      before: 'A\n',
      after: 'C\n',
      author: 'Programmer',
    });
    await ws.writeText('a.gd', 'A\n', 'Programmer');
    expect(ws.changes!.size).toBe(0);
  });

  it('shares the change set between policy views', async () => {
    const root = tempDir();
    const ws = Workspace.open(root);
    const user = ws.withPolicy('user');
    ws.beginChanges('staged');
    await ws.writeText('x.gd', 'x', 'Programmer');
    expect(user.changes?.size).toBe(1);
    expect(await user.readText('x.gd')).toBe('x');
  });
});
