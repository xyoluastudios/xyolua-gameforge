import { Bug, Gamepad2, Play, RotateCcw, Square } from 'lucide-react';
import { restartGame, runGame, stopGame } from '../actions';
import { useStore } from '../store';

export function PreviewPanel() {
  const game = useStore((s) => s.game);
  const preview = useStore((s) => s.preview);
  const project = useStore((s) => s.project);
  const engine = useStore((s) => s.engine);

  return (
    <div className="workspace-body" data-testid="preview-panel">
      <div className="toolbar">
        <span className="title">Game Preview</span>
        <button
          className="btn small primary"
          onClick={() => runGame('play')}
          disabled={game.running}
          data-testid="play"
        >
          <Play size={13} /> Play
        </button>
        <button
          className="btn small"
          onClick={() => stopGame()}
          disabled={!game.running}
          data-testid="stop"
        >
          <Square size={12} /> Stop
        </button>
        <button className="btn small" onClick={() => restartGame()} disabled={!game.running}>
          <RotateCcw size={13} /> Restart
        </button>
        <button
          className="btn small"
          onClick={() => runGame('debug')}
          disabled={game.running}
          title="Run with visible collision shapes and verbose output"
        >
          <Bug size={13} /> Debug
        </button>
        <span className="sep" />
        <span className={`status-dot ${game.running ? 'ok' : ''}`} />
        <span className="muted">
          {game.running ? `Running${game.mode === 'debug' ? ' (debug)' : ''}` : 'Stopped'}
        </span>
        <span className="grow" />
        <span className="faint" style={{ fontSize: 11.5 }}>
          {engine ? `Godot ${engine.version}` : engine === null ? 'Godot not detected' : ''}
          {project?.mainScene ? ` · ${project.mainScene.replace('res://', '')}` : ''}
        </span>
      </div>
      <div className="preview-stage">
        {preview && game.running ? (
          <img
            className="preview-frame"
            src={preview}
            alt="Live game preview"
            data-testid="preview-frame"
          />
        ) : (
          <div className="preview-placeholder">
            <Gamepad2 size={40} color="#3a4252" />
            <div className="big">
              {game.running ? 'Waiting for the first frame…' : 'Press Play to run the game'}
            </div>
            <div>
              {game.running
                ? 'The game runs in its own window. Projects created by GameForge mirror their frames here.'
                : 'Godot opens the game in a separate window; stdout and stderr appear in the Terminal panel.'}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
