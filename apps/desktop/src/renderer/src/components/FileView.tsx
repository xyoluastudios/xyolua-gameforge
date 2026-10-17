import { Save, Sparkles, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { UserFacingError } from '@shared/api';
import { asUserError, call, on } from '../api';
import { handleOutcome, markDirty, openTab, showError, toast } from '../actions';
import { CodeEditor, type EditorDiagnostic } from '../editor/CodeEditor';
import { useStore, type Tab } from '../store';
import { ErrorCallout, Spinner } from './ui';

export function FileView({ tab }: { tab: Tab }) {
  const path = tab.path!;
  const [content, setContent] = useState<string | null>(null);
  const [error, setError] = useState<UserFacingError | null>(null);
  const [aiBar, setAiBar] = useState<{
    selection?: { startLine: number; endLine: number; text: string };
  } | null>(null);
  const [instruction, setInstruction] = useState('');
  const [aiBusy, setAiBusy] = useState(false);
  const current = useRef<string>('');
  const saved = useRef<string>('');
  const analysis = useStore((s) => s.analysis);
  const reveal = useStore((s) => (s.reveal?.path === path ? s.reveal : null));
  const dirty = tab.dirty ?? false;

  const load = useCallback(async () => {
    try {
      const text = await call('project:read-file', path);
      saved.current = text;
      current.current = text;
      setContent(text);
      setError(null);
      markDirty(tab.id, false);
    } catch (e) {
      setError(asUserError(e));
    }
  }, [path, tab.id]);

  useEffect(() => {
    void load();
  }, [load]);

  // Reload when the file changes on disk (agents, git, Godot) and there are no unsaved edits.
  useEffect(
    () =>
      on('files-changed', ({ paths }) => {
        if (paths.includes(path) && current.current === saved.current) void load();
      }),
    [path, load],
  );

  const save = async (text = current.current) => {
    try {
      await call('project:write-file', path, text);
      saved.current = text;
      markDirty(tab.id, false);
    } catch (e) {
      showError(e, 'Could not save the file');
    }
  };

  const diagnostics = useMemo<EditorDiagnostic[]>(
    () =>
      (analysis?.issues ?? [])
        .filter((i) => i.file === path && i.line)
        .map((i) => ({
          line: i.line!,
          severity:
            i.severity === 'critical' || i.severity === 'high'
              ? 'error'
              : i.severity === 'medium'
                ? 'warning'
                : 'info',
          message: `${i.title}: ${i.message}`,
        })),
    [analysis, path],
  );

  const runAiEdit = async () => {
    if (!instruction.trim()) return;
    if (dirty) await save();
    setAiBusy(true);
    try {
      const outcome = await call('ai:edit', path, instruction.trim(), aiBar?.selection);
      handleOutcome(outcome);
      if (outcome.kind === 'agent') {
        if (outcome.changes.some((c) => c.path === path)) {
          openTab({ id: 'changes', kind: 'changes', title: 'Review Changes' });
          toast('info', 'AI edit ready for review', outcome.summary.slice(0, 160));
        } else {
          toast('warn', 'The AI made no change to this file', outcome.summary.slice(0, 200));
        }
      }
      setAiBar(null);
      setInstruction('');
    } catch (e) {
      showError(e, 'AI edit failed');
    } finally {
      setAiBusy(false);
    }
  };

  if (error) {
    return (
      <div className="workspace-body" style={{ padding: 16 }}>
        <ErrorCallout error={error} />
      </div>
    );
  }
  if (content === null) {
    return (
      <div className="workspace-body">
        <div className="empty">
          <Spinner />
        </div>
      </div>
    );
  }

  return (
    <div className="workspace-body" data-testid="file-view">
      <div className="toolbar">
        <span className="mono muted ellipsis" style={{ fontSize: 12 }}>
          {path}
        </span>
        <span className="grow" />
        <button
          className="btn small ghost"
          onClick={() => setAiBar(aiBar ? null : {})}
          title="Ask the AI to edit this file (Ctrl+I)"
        >
          <Sparkles size={13} /> AI edit
        </button>
        <button
          className="btn small"
          onClick={() => save()}
          disabled={!dirty}
          title="Save (Ctrl+S)"
        >
          <Save size={13} /> Save
        </button>
      </div>
      {aiBar && (
        <div className="ai-edit-bar">
          <Sparkles size={14} color="var(--accent)" />
          <input
            className="input"
            autoFocus
            placeholder={
              aiBar.selection
                ? `Edit lines ${aiBar.selection.startLine}-${aiBar.selection.endLine}: e.g. "make the monster faster"`
                : 'Describe the change, e.g. "add a double jump"'
            }
            value={instruction}
            onChange={(e) => setInstruction(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void runAiEdit();
              if (e.key === 'Escape') setAiBar(null);
            }}
            disabled={aiBusy}
          />
          {aiBusy ? <Spinner /> : null}
          <button
            className="btn small primary"
            onClick={() => runAiEdit()}
            disabled={aiBusy || !instruction.trim()}
          >
            Edit
          </button>
          <button className="icon-btn" onClick={() => setAiBar(null)} aria-label="Close AI edit">
            <X size={14} />
          </button>
        </div>
      )}
      <CodeEditor
        path={path}
        value={content}
        diagnostics={diagnostics}
        revealLine={reveal}
        onChange={(text) => {
          current.current = text;
          markDirty(tab.id, text !== saved.current);
        }}
        onSave={(text) => save(text)}
        onAiEdit={(selection) => setAiBar(selection ? { selection } : {})}
      />
    </div>
  );
}
