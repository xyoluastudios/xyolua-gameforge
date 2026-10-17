import { MergeView } from '@codemirror/merge';
import { EditorState } from '@codemirror/state';
import { EditorView, lineNumbers } from '@codemirror/view';
import { useEffect, useRef } from 'react';
import { languageFor } from './languages';
import { forgeHighlight, forgeTheme } from './theme';

interface Props {
  path: string;
  before: string;
  after: string;
}

/** Side-by-side before / after view of an AI change (read-only). */
export function DiffView({ path, before, after }: Props) {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!host.current) return;
    const extensions = [
      lineNumbers(),
      forgeTheme,
      forgeHighlight,
      ...languageFor(path),
      EditorState.readOnly.of(true),
      EditorView.editable.of(false),
      // Side-by-side panes are narrow; wrap instead of hiding changes off-screen.
      EditorView.lineWrapping,
    ];
    const view = new MergeView({
      a: { doc: before, extensions },
      b: { doc: after, extensions },
      parent: host.current,
      highlightChanges: true,
      gutter: true,
      collapseUnchanged: { margin: 3, minSize: 6 },
    });
    return () => view.destroy();
  }, [path, before, after]);
  return (
    <div
      className="editor-host diff-host"
      ref={host}
      data-testid="diff-view"
      style={{ overflow: 'auto' }}
    />
  );
}

/** Renders a unified diff string (git output) with colors. */
export function UnifiedDiff({ diff }: { diff: string }) {
  if (!diff.trim()) return <div className="empty">No differences.</div>;
  return (
    <pre className="diff">
      {diff.split('\n').map((line, index) => {
        const kind = line.startsWith('@@')
          ? 'hunk'
          : line.startsWith('+++') ||
              line.startsWith('---') ||
              line.startsWith('diff ') ||
              line.startsWith('index ')
            ? 'meta'
            : line.startsWith('+')
              ? 'add'
              : line.startsWith('-')
                ? 'del'
                : '';
        return (
          <div key={index} className={`l ${kind}`}>
            {line || ' '}
          </div>
        );
      })}
    </pre>
  );
}
