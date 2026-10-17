import { AlertTriangle, Gamepad2 } from 'lucide-react';
import type { ConfirmationDecision } from '@shared/api';
import { call } from '../api';
import { detectEngine, openSettings, runGame } from '../actions';
import { store, useStore } from '../store';
import { Modal } from './ui';

/** "⚠️ Confirmation required" — shown whenever an agent wants to do something risky. */
export function ConfirmDialog() {
  const request = useStore((s) => s.confirms[0]);
  if (!request) return null;
  const respond = (decision: ConfirmationDecision) => {
    void call('confirm:respond', request.id, decision);
    store.set((s) => ({ confirms: s.confirms.slice(1) }));
  };
  return (
    <Modal
      title="Confirmation required"
      icon={<AlertTriangle size={17} color="var(--yellow)" />}
      onClose={() => respond('deny')}
      size="small"
      testId="confirm-dialog"
      footer={
        <>
          <button className="btn left" onClick={() => respond('deny')} data-testid="confirm-cancel">
            Cancel
          </button>
          <button className="btn" onClick={() => respond('project')} data-testid="confirm-project">
            Allow for project
          </button>
          <button
            className="btn primary"
            onClick={() => respond('once')}
            autoFocus
            data-testid="confirm-once"
          >
            Allow once
          </button>
        </>
      }
    >
      <div style={{ whiteSpace: 'pre-wrap', marginBottom: request.command ? 10 : 0 }}>
        {request.message.split('\n\n')[0]}
      </div>
      {request.command && (
        <pre
          className="mono"
          style={{
            margin: '0 0 10px',
            padding: 10,
            borderRadius: 6,
            background: 'var(--bg-input)',
            border: '1px solid var(--border)',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-all',
            fontSize: 12,
          }}
        >
          {request.command}
        </pre>
      )}
      <div className="muted" style={{ whiteSpace: 'pre-wrap' }}>
        {request.message
          .split('\n\n')
          .slice(request.command ? 2 : 1)
          .join('\n\n')}
      </div>
      <div className="hint" style={{ marginTop: 10 }}>
        Requested by {request.requestedBy} · risk: {request.risk}. “Allow for project” is remembered
        in your user settings, not in the project.
      </div>
    </Modal>
  );
}

export function GodotMissingDialog() {
  const open = useStore((s) => s.dialogs.godotMissing);
  if (!open) return null;
  const close = () => store.set((s) => ({ dialogs: { ...s.dialogs, godotMissing: false } }));
  return (
    <Modal
      title="Godot not detected."
      icon={<Gamepad2 size={17} color="var(--yellow)" />}
      onClose={close}
      size="small"
      testId="godot-missing"
      footer={
        <>
          <button className="btn left" onClick={close}>
            Cancel
          </button>
          <button
            className="btn"
            onClick={() => call('app:open-external', 'https://godotengine.org/download')}
          >
            Install Guide
          </button>
          <button
            className="btn primary"
            onClick={async () => {
              const exe = await call('dialog:select-godot');
              if (!exe) return;
              await detectEngine();
              close();
              if (store.get().engine) void runGame('play');
              else openSettings('godot');
            }}
          >
            Select Godot Executable
          </button>
        </>
      }
    >
      <p style={{ marginTop: 0 }}>
        GameForge needs Godot 4.3 or newer to run, validate and test games. Projects can still be
        generated and analyzed without it.
      </p>
      <p className="muted" style={{ marginBottom: 0 }}>
        GameForge never installs software without your consent — download Godot from godotengine.org
        (a single executable, no installer needed) and select it here.
      </p>
    </Modal>
  );
}

export function Toasts() {
  const toasts = useStore((s) => s.toasts);
  return (
    <div className="toast-stack" aria-live="polite">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`toast ${t.level}`}
          role={t.level === 'error' ? 'alert' : 'status'}
        >
          <div className="title">{t.title}</div>
          {t.text && (
            <div className="muted" style={{ whiteSpace: 'pre-wrap' }}>
              {t.text}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
