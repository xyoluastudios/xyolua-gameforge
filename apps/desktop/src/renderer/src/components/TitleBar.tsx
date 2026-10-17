import { FolderOpen, Plus, Search, Settings } from 'lucide-react';
import { createGame, openPalette, openProject, openSettings } from '../actions';
import { useStore } from '../store';
import { Kbd, Logo } from './ui';

export function TitleBar() {
  const project = useStore((s) => s.project);
  const platform = useStore((s) => s.info?.platform);
  return (
    <header className={`titlebar ${platform === 'darwin' ? 'mac' : ''}`}>
      <div className="brand">
        <Logo />
        <span>XyoLua</span>
        <span className="product">GameForge</span>
      </div>
      {project && <span className="project-name">— {project.name}</span>}
      <span className="spacer" />
      <button className="palette-hint" onClick={() => openPalette()} data-testid="palette-hint">
        <Search size={13} />
        <span className="grow" style={{ textAlign: 'left' }}>
          Search commands and files
        </span>
        <Kbd>Ctrl K</Kbd>
      </button>
      <span className="spacer" />
      <div className="actions">
        <button
          className="btn ghost small"
          onClick={() => createGame()}
          title="Create Game (Ctrl+N)"
        >
          <Plus size={14} /> Create Game
        </button>
        <button
          className="btn ghost small"
          onClick={() => openProject()}
          title="Open Project (Ctrl+O)"
        >
          <FolderOpen size={14} /> Project
        </button>
        <button
          className="btn ghost small"
          onClick={() => openSettings()}
          title="Settings (Ctrl+,)"
          data-testid="open-settings"
        >
          <Settings size={14} /> Settings
        </button>
      </div>
    </header>
  );
}
