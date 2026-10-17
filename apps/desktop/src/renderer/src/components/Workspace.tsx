import { ClipboardList, FileDiff, Gamepad2, GitCompare, Home, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { call } from '../api';
import { closeTab } from '../actions';
import { UnifiedDiff } from '../editor/DiffView';
import { store, useStore, type Tab } from '../store';
import { AnalysisView } from './AnalysisView';
import { ChangesView } from './ChangesView';
import { FileView } from './FileView';
import { PreviewPanel } from './PreviewPanel';
import { fileIcon } from './Sidebar';
import { Welcome } from './Welcome';

function tabIcon(tab: Tab) {
  switch (tab.kind) {
    case 'welcome':
      return <Home size={13} />;
    case 'preview':
      return <Gamepad2 size={13} />;
    case 'analysis':
      return <ClipboardList size={13} />;
    case 'changes':
      return <FileDiff size={13} />;
    case 'git-diff':
      return <GitCompare size={13} />;
    default:
      return fileIcon(tab.path ?? '', 13);
  }
}

function GitDiffView({ path }: { path: string }) {
  const [diff, setDiff] = useState<string | null>(null);
  useEffect(() => {
    void call('git:diff', path)
      .then(setDiff)
      .catch(() => setDiff(''));
  }, [path]);
  return (
    <div className="workspace-body">
      <div className="toolbar">
        <span className="title">Git diff</span>
        <span className="mono muted">{path}</span>
      </div>
      <div className="scroll" style={{ flex: 1 }}>
        {diff === null ? null : <UnifiedDiff diff={diff} />}
      </div>
    </div>
  );
}

export function Workspace() {
  const tabs = useStore((s) => s.tabs);
  const activeId = useStore((s) => s.activeTab);
  const changes = useStore((s) => s.changes.length);
  const active = tabs.find((t) => t.id === activeId) ?? tabs[0];

  return (
    <section className="column center" data-testid="workspace">
      <div className="tabs" role="tablist">
        {tabs.map((tab) => (
          <div
            key={tab.id}
            role="tab"
            aria-selected={tab.id === active?.id}
            className={`tab ${tab.id === active?.id ? 'active' : ''} ${tab.dirty ? 'dirty' : ''}`}
            onClick={() => store.set({ activeTab: tab.id })}
            onMouseDown={(e) => {
              if (e.button === 1) {
                e.preventDefault();
                closeTab(tab.id);
              }
            }}
            title={tab.path ?? tab.title}
          >
            {tabIcon(tab)}
            <span>{tab.title}</span>
            {tab.kind === 'changes' && changes > 0 && (
              <span className="badge accent">{changes}</span>
            )}
            <span
              className="close"
              onClick={(e) => {
                e.stopPropagation();
                closeTab(tab.id);
              }}
              aria-label={`Close ${tab.title}`}
            >
              {tab.dirty ? <span className="dot" /> : <X size={12} />}
            </span>
          </div>
        ))}
      </div>
      {active?.kind === 'welcome' && <Welcome />}
      {active?.kind === 'preview' && <PreviewPanel />}
      {active?.kind === 'analysis' && <AnalysisView />}
      {active?.kind === 'changes' && <ChangesView />}
      {active?.kind === 'git-diff' && active.path && (
        <GitDiffView key={active.path} path={active.path} />
      )}
      {active?.kind === 'file' && <FileView key={active.id} tab={active} />}
    </section>
  );
}
