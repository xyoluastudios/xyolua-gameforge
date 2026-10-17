import { Check, GitCommitHorizontal, Undo2, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { FileChange } from '@shared/api';
import { call } from '../api';
import { applyChanges, discardChanges, setLayout, showError, toast } from '../actions';
import { DiffView } from '../editor/DiffView';
import { useStore } from '../store';

/** Review AI changes file by file before they touch the disk. */
export function ChangesView() {
  const changes = useStore((s) => s.changes);
  const project = useStore((s) => s.project);
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<FileChange | null>(null);
  const [applied, setApplied] = useState<number | null>(null);

  const current =
    selected && changes.some((c) => c.path === selected) ? selected : (changes[0]?.path ?? null);

  useEffect(() => {
    if (!current) {
      setDetail(null);
      return;
    }
    void call('changes:get', current)
      .then(setDetail)
      .catch(() => setDetail(null));
  }, [current, changes]);

  const additions = changes.reduce((sum, c) => sum + c.additions, 0);
  const deletions = changes.reduce((sum, c) => sum + c.deletions, 0);

  if (changes.length === 0) {
    return (
      <div className="workspace-body" data-testid="changes-view">
        {applied !== null ? (
          <div style={{ padding: 18 }}>
            <div className="callout success">
              <Check size={16} color="var(--green)" />
              <div className="grow">
                <div className="title">Changes applied. {applied} file(s) changed.</div>
                <div className="muted">
                  Tests run automatically when Godot is available. Review the result, then commit.
                </div>
              </div>
              {project?.isGit && (
                <button
                  className="btn small"
                  onClick={() => setLayout({ bottom: true, bottomTab: 'git' })}
                >
                  <GitCommitHorizontal size={13} /> Commit
                </button>
              )}
              <button
                className="btn small danger"
                onClick={async () => {
                  try {
                    const count = await call('changes:revert-applied');
                    toast('info', `Reverted ${count} file(s)`);
                    setApplied(null);
                  } catch (error) {
                    showError(error);
                  }
                }}
              >
                <Undo2 size={13} /> Undo apply
              </button>
            </div>
          </div>
        ) : (
          <div className="empty">
            No pending AI changes. When agents change files, you review them here before anything is
            written.
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="workspace-body" data-testid="changes-view">
      <div className="toolbar">
        <span className="title">AI created changes</span>
        <span className="muted">
          {changes.length} file{changes.length === 1 ? '' : 's'} changed ·{' '}
          <span className="add">+{additions}</span> <span className="del">−{deletions}</span>
        </span>
        <span className="grow" />
        <button
          className="btn small danger"
          onClick={() => discardChanges()}
          data-testid="discard-all"
        >
          <X size={13} /> Discard all
        </button>
        <button
          className="btn small primary"
          onClick={async () => {
            const count = changes.length;
            await applyChanges();
            setApplied(count);
          }}
          data-testid="apply-all"
        >
          <Check size={13} /> Apply all
        </button>
      </div>
      <div className="split">
        <div className="list">
          {changes.map((change) => (
            <div
              key={change.path}
              className={`change-row ${change.path === current ? 'active' : ''}`}
              onClick={() => setSelected(change.path)}
            >
              <span className={`kind ${change.kind}`}>
                {change.kind === 'create' ? 'A' : change.kind === 'delete' ? 'D' : 'M'}
              </span>
              <span className="ellipsis grow mono" style={{ fontSize: 12 }} title={change.path}>
                {change.path}
              </span>
              <span className="add" style={{ fontSize: 11 }}>
                +{change.additions}
              </span>
              <span className="del" style={{ fontSize: 11 }}>
                −{change.deletions}
              </span>
            </div>
          ))}
        </div>
        <div className="detail" style={{ display: 'flex', flexDirection: 'column' }}>
          {detail && (
            <>
              <div className="toolbar">
                <span className="mono" style={{ fontSize: 12 }}>
                  {detail.path}
                </span>
                <span className="faint">by {detail.author}</span>
                <span className="grow" />
                <button className="btn small" onClick={() => discardChanges([detail.path])}>
                  Discard file
                </button>
                <button className="btn small" onClick={() => applyChanges([detail.path])}>
                  Apply file
                </button>
              </div>
              <div
                className="row faint"
                style={{
                  padding: '4px 12px',
                  fontSize: 11,
                  borderBottom: '1px solid var(--border)',
                }}
              >
                <span className="grow">Before</span>
                <span className="grow">After</span>
              </div>
              <DiffView
                path={detail.path}
                before={detail.before ?? ''}
                after={detail.after ?? ''}
              />
            </>
          )}
        </div>
      </div>
    </div>
  );
}
