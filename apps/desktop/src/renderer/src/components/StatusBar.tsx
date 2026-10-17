import { AlertCircle, Bot, FileDiff, Gamepad2, GitBranch, PanelBottom } from 'lucide-react';
import { openSettings, reviewChanges, setLayout } from '../actions';
import { useStore } from '../store';
import { Spinner } from './ui';

export function StatusBar() {
  const project = useStore((s) => s.project);
  const settings = useStore((s) => s.settings);
  const engine = useStore((s) => s.engine);
  const game = useStore((s) => s.game);
  const busy = useStore((s) => s.busy);
  const changes = useStore((s) => s.changes.length);
  const problems = useStore((s) => s.analysis?.issues.filter((i) => i.severity !== 'info').length);
  const bottom = useStore((s) => s.layout.bottom);

  return (
    <footer className="statusbar" data-testid="statusbar">
      {project ? (
        <span className="item">
          <GitBranch size={12} />
          {project.name}
          {project.isGit ? '' : ' (no git)'}
        </span>
      ) : (
        <span className="item faint">No project</span>
      )}
      {busy && (
        <span className="item">
          <Spinner /> Agents working…
        </span>
      )}
      {changes > 0 && (
        <button className="item" onClick={() => reviewChanges()} style={{ color: 'var(--accent)' }}>
          <FileDiff size={12} /> {changes} change{changes === 1 ? '' : 's'} to review
        </button>
      )}
      <span className="grow" />
      {problems !== undefined && (
        <button className="item" onClick={() => setLayout({ bottom: true, bottomTab: 'problems' })}>
          <AlertCircle size={12} /> {problems}
        </button>
      )}
      <span className="item">
        <Gamepad2 size={12} color={game.running ? 'var(--green)' : undefined} />
        {game.running
          ? 'Game running'
          : engine
            ? `Godot ${engine.version.split('.').slice(0, 3).join('.')}`
            : engine === null
              ? 'Godot not found'
              : 'Godot…'}
      </span>
      <button className="item" onClick={() => openSettings('ai')}>
        <Bot size={12} /> {settings?.activeLabel ?? '…'}
      </button>
      <button
        className="item"
        onClick={() => setLayout({ bottom: !bottom })}
        title="Toggle panel (Ctrl+J)"
      >
        <PanelBottom size={12} />
      </button>
    </footer>
  );
}
