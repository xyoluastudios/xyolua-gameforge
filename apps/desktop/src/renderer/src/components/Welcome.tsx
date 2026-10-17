import { Bot, CheckCircle2, CircleAlert, FolderOpen, Gamepad2, History, Wand2 } from 'lucide-react';
import { createGame, openProject, openSettings } from '../actions';
import { useStore } from '../store';
import { Kbd, Logo } from './ui';

export function Welcome() {
  const recent = useStore((s) => s.recent);
  const settings = useStore((s) => s.settings);
  const engine = useStore((s) => s.engine);
  const hasProvider =
    !!settings &&
    settings.activeLabel !== 'No AI provider' &&
    !settings.activeLabel.includes('not configured');

  return (
    <div className="welcome" data-testid="welcome">
      <div className="welcome-inner">
        <div className="row" style={{ marginBottom: 10 }}>
          <Logo size={34} />
        </div>
        <h1>XyoLua GameForge</h1>
        <p className="lead">
          Describe a game, review the plan, get a playable Godot project — built by a team of AI
          agents on your machine.
        </p>
        <div className="welcome-grid">
          <div>
            <h3>Start</h3>
            <button
              className="action-card"
              onClick={() => createGame()}
              data-testid="welcome-create"
            >
              <span className="icon">
                <Wand2 size={18} />
              </span>
              <span>
                <div className="t">Create Game</div>
                <div className="d">From an idea to a Godot project with a reviewed plan.</div>
              </span>
              <span className="grow" />
              <Kbd>Ctrl N</Kbd>
            </button>
            <button className="action-card" onClick={() => openProject()}>
              <span className="icon">
                <FolderOpen size={18} />
              </span>
              <span>
                <div className="t">Open Project</div>
                <div className="d">Analyze and fix an existing Godot 4 project.</div>
              </span>
              <span className="grow" />
              <Kbd>Ctrl O</Kbd>
            </button>
            {recent.length > 0 && (
              <>
                <h3 style={{ marginTop: 22 }}>Recent</h3>
                {recent.slice(0, 6).map((root) => (
                  <button
                    key={root}
                    className="list-row"
                    onClick={() => openProject(root)}
                    title={root}
                  >
                    <History size={13} color="#5f6878" />
                    <span>{root.split(/[\\/]/).pop()}</span>
                    <span className="meta ellipsis" style={{ maxWidth: 220 }}>
                      {root}
                    </span>
                  </button>
                ))}
              </>
            )}
          </div>
          <div>
            <h3>Setup</h3>
            <div className="check-row">
              {hasProvider ? (
                <CheckCircle2 size={15} color="var(--green)" />
              ) : (
                <CircleAlert size={15} color="var(--yellow)" />
              )}
              <Bot size={14} className="muted" />
              <span className="grow">{settings?.activeLabel ?? '…'}</span>
              <button className="btn small" onClick={() => openSettings('ai')}>
                {hasProvider ? 'Change' : 'Configure'}
              </button>
            </div>
            <div className="check-row">
              {engine ? (
                <CheckCircle2 size={15} color="var(--green)" />
              ) : (
                <CircleAlert size={15} color="var(--yellow)" />
              )}
              <Gamepad2 size={14} className="muted" />
              <span className="grow">
                {engine === undefined
                  ? 'Detecting Godot…'
                  : engine
                    ? `Godot ${engine.version}`
                    : 'Godot not detected'}
              </span>
              <button className="btn small" onClick={() => openSettings('godot')}>
                {engine ? 'Settings' : 'Set up'}
              </button>
            </div>
            {settings && !settings.generative && hasProvider && (
              <p className="hint" style={{ marginTop: 10 }}>
                The offline mock provider plans games with templates only — no AI writes code.
                Configure Anthropic, an OpenAI-compatible API or Ollama for the full agent team.
              </p>
            )}
            <h3 style={{ marginTop: 22 }}>Shortcuts</h3>
            <div className="hint" style={{ lineHeight: 2 }}>
              <Kbd>Ctrl K</Kbd> commands · <Kbd>Ctrl P</Kbd> files · <Kbd>F5</Kbd> run game ·{' '}
              <Kbd>Ctrl L</Kbd> ask AI · <Kbd>Ctrl J</Kbd> panel · <Kbd>Ctrl I</Kbd> AI edit
            </div>
            <h3 style={{ marginTop: 22 }}>Privacy</h3>
            <p className="hint">
              No accounts, no telemetry. Your code is only sent to the AI provider you configure.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
