/**
 * Line-based diff (Myers' O(ND) algorithm) and unified-diff rendering.
 * Used to show "before / after" for every AI change, also outside of git.
 */

export type DiffOp = { type: 'equal' | 'insert' | 'delete'; line: string };

export function splitLines(text: string): string[] {
  if (text === '') return [];
  const lines = text.split(/\r?\n/);
  if (lines[lines.length - 1] === '') lines.pop();
  return lines;
}

export function diffLines(before: string, after: string): DiffOp[] {
  const a = splitLines(before);
  const b = splitLines(after);
  const n = a.length;
  const m = b.length;
  const max = n + m;
  const v = new Map<number, number>([[1, 0]]);
  const trace: Map<number, number>[] = [];

  outer: for (let d = 0; d <= max; d++) {
    trace.push(new Map(v));
    for (let k = -d; k <= d; k += 2) {
      let x: number;
      if (k === -d || (k !== d && (v.get(k - 1) ?? -1) < (v.get(k + 1) ?? -1))) {
        x = v.get(k + 1) ?? 0;
      } else {
        x = (v.get(k - 1) ?? 0) + 1;
      }
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) {
        x++;
        y++;
      }
      v.set(k, x);
      if (x >= n && y >= m) break outer;
    }
  }

  // Backtrack to build the edit script.
  const ops: DiffOp[] = [];
  let x = n;
  let y = m;
  for (let d = trace.length - 1; d >= 0 && (x > 0 || y > 0); d--) {
    const vd = trace[d]!;
    const k = x - y;
    let prevK: number;
    if (k === -d || (k !== d && (vd.get(k - 1) ?? -1) < (vd.get(k + 1) ?? -1))) {
      prevK = k + 1;
    } else {
      prevK = k - 1;
    }
    const prevX = vd.get(prevK) ?? 0;
    const prevY = prevX - prevK;
    while (x > prevX && y > prevY) {
      ops.push({ type: 'equal', line: a[x - 1]! });
      x--;
      y--;
    }
    if (d > 0) {
      if (x === prevX) {
        ops.push({ type: 'insert', line: b[y - 1]! });
        y--;
      } else {
        ops.push({ type: 'delete', line: a[x - 1]! });
        x--;
      }
    }
  }
  return ops.reverse();
}

export interface DiffStats {
  additions: number;
  deletions: number;
}

export function diffStats(before: string, after: string): DiffStats {
  let additions = 0;
  let deletions = 0;
  for (const op of diffLines(before, after)) {
    if (op.type === 'insert') additions++;
    else if (op.type === 'delete') deletions++;
  }
  return { additions, deletions };
}

/** Renders a git-style unified diff with `context` lines around each change. */
export function unifiedDiff(
  path: string,
  before: string | null,
  after: string | null,
  context = 3,
): string {
  const ops = diffLines(before ?? '', after ?? '');
  const header = [
    `--- ${before === null ? '/dev/null' : `a/${path}`}`,
    `+++ ${after === null ? '/dev/null' : `b/${path}`}`,
  ];
  if (!ops.some((op) => op.type !== 'equal')) return '';

  // Annotate ops with line numbers.
  let aLine = 1;
  let bLine = 1;
  const annotated = ops.map((op) => {
    const entry = { ...op, a: aLine, b: bLine };
    if (op.type !== 'insert') aLine++;
    if (op.type !== 'delete') bLine++;
    return entry;
  });

  const hunks: string[] = [];
  let i = 0;
  while (i < annotated.length) {
    if (annotated[i]!.type === 'equal') {
      i++;
      continue;
    }
    const start = Math.max(0, i - context);
    let end = i;
    // Extend hunk while changes are within 2*context of each other.
    while (end < annotated.length) {
      if (annotated[end]!.type !== 'equal') {
        end++;
        continue;
      }
      let next = end;
      while (next < annotated.length && annotated[next]!.type === 'equal') next++;
      if (next < annotated.length && next - end <= context * 2) {
        end = next;
      } else {
        end = Math.min(annotated.length, end + context);
        break;
      }
    }
    const slice = annotated.slice(start, end);
    const aStart = slice[0]!.a;
    const bStart = slice[0]!.b;
    const aCount = slice.filter((op) => op.type !== 'insert').length;
    const bCount = slice.filter((op) => op.type !== 'delete').length;
    hunks.push(
      `@@ -${aCount === 0 ? aStart - 1 : aStart},${aCount} +${bCount === 0 ? bStart - 1 : bStart},${bCount} @@`,
    );
    for (const op of slice) {
      const prefix = op.type === 'equal' ? ' ' : op.type === 'insert' ? '+' : '-';
      hunks.push(`${prefix}${op.line}`);
    }
    i = end;
  }
  return [...header, ...hunks].join('\n');
}
