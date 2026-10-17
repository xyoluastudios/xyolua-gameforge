import { CornerDownLeft, File, Terminal } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { FileNode } from '@shared/api';
import { openFile } from '../actions';
import { COMMANDS, fuzzyScore } from '../commands';
import { store, useStore } from '../store';
import { Kbd } from './ui';

interface Entry {
  id: string;
  title: string;
  detail?: string;
  icon: 'command' | 'file';
  run: () => void;
}

function flatten(nodes: FileNode[]): FileNode[] {
  return nodes.flatMap((n) => (n.type === 'directory' ? flatten(n.children ?? []) : [n]));
}

export function CommandPalette() {
  const { open, mode } = useStore((s) => s.dialogs.palette);
  const tree = useStore((s) => s.tree);
  const [query, setQuery] = useState('');
  const [index, setIndex] = useState(0);
  const input = useRef<HTMLInputElement>(null);

  const close = () => {
    // Reset on close (not on open) so fast typing right after opening is never lost.
    setQuery('');
    setIndex(0);
    store.set((s) => ({ dialogs: { ...s.dialogs, palette: { open: false, mode: 'commands' } } }));
  };

  useEffect(() => {
    if (open) input.current?.focus();
  }, [open, mode]);

  const entries = useMemo<Entry[]>(() => {
    const fileMode = mode === 'files' || query.startsWith('/');
    const q = fileMode && query.startsWith('/') ? query.slice(1) : query;
    if (fileMode) {
      return flatten(tree)
        .filter(
          (file) => !/\.(png|jpe?g|webp|wav|ogg|mp3|glb|gltf|ttf|otf|import)$/i.test(file.path),
        )
        .map((file) => ({ file, score: fuzzyScore(q, file.path) }))
        .filter((x) => x.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, 50)
        .map(({ file }) => ({
          id: file.path,
          title: file.name,
          detail: file.path,
          icon: 'file' as const,
          run: () => openFile(file.path),
        }));
    }
    return COMMANDS.filter((c) => c.available?.() ?? true)
      .map((c) => ({ c, score: fuzzyScore(q, c.title) }))
      .filter((x) => x.score > 0)
      .sort((a, b) => (q ? b.score - a.score : 0))
      .map(({ c }) => ({
        id: c.id,
        title: c.title,
        ...(c.shortcut ? { detail: c.shortcut } : {}),
        icon: 'command' as const,
        run: () => void c.run(),
      }));
  }, [query, mode, tree]);

  if (!open) return null;

  const execute = (entry?: Entry) => {
    if (!entry) return;
    close();
    entry.run();
  };

  return (
    <div
      className="overlay"
      style={{ background: 'rgba(5,6,8,0.35)', placeItems: 'start center' }}
      onMouseDown={(e) => e.target === e.currentTarget && close()}
    >
      <div
        className="palette"
        role="dialog"
        aria-label="Command palette"
        data-testid="command-palette"
      >
        <input
          ref={input}
          autoFocus
          value={query}
          placeholder={
            mode === 'files' ? 'Search files by name…' : 'Type a command — or "/" to search files'
          }
          onChange={(e) => {
            setQuery(e.target.value);
            setIndex(0);
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setIndex((i) => Math.min(i + 1, entries.length - 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setIndex((i) => Math.max(i - 1, 0));
            } else if (e.key === 'Enter') {
              e.preventDefault();
              execute(entries[index]);
            } else if (e.key === 'Escape') {
              e.preventDefault();
              close();
            }
          }}
          aria-label="Command"
        />
        <ul role="listbox">
          {entries.length === 0 && <li className="faint">No matches</li>}
          {entries.map((entry, i) => (
            <li
              key={entry.id}
              role="option"
              aria-selected={i === index}
              className={i === index ? 'selected' : ''}
              onMouseEnter={() => setIndex(i)}
              onMouseDown={(e) => {
                e.preventDefault();
                execute(entry);
              }}
            >
              {entry.icon === 'file' ? (
                <File size={14} color="#8a93a3" />
              ) : (
                <Terminal size={14} color="#8a93a3" />
              )}
              <span>{entry.title}</span>
              {entry.detail && (
                <span className="detail">
                  {entry.icon === 'command' ? <Kbd>{entry.detail}</Kbd> : entry.detail}
                </span>
              )}
              {i === index && <CornerDownLeft size={12} color="#5f6878" />}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
