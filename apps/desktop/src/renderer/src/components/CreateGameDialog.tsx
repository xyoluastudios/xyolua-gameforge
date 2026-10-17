import {
  CheckCircle2,
  CircleDashed,
  FolderOpen,
  Pencil,
  Play,
  RefreshCw,
  Wand2,
  XCircle,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import type { CreateGameView, GamePlan, UserFacingError } from '@shared/api';
import { asUserError, call, on } from '../api';
import {
  afterProjectOpened,
  openSettings,
  refreshSettings,
  reviewChanges,
  runGame,
} from '../actions';
import { store, useStore } from '../store';
import { PlanView } from './PlanView';
import { ErrorCallout, Modal, Spinner } from './ui';

type Step = { step: string; label: string; agent: string; status: string; detail?: string };
type Phase = 'describe' | 'planning' | 'review' | 'edit' | 'generating' | 'done';

const EXAMPLES = [
  'A 3D horror game inside an abandoned hospital. Find keys, open doors and escape a monster that hunts you.',
  'A 2D top-down dungeon crawler with three keys, locked doors, slimes and a save system.',
  'A first-person exploration game in a flooded research lab with a flashlight and random events.',
];

export function CreateGameDialog() {
  const dialog = useStore((s) => s.dialogs.create);
  const info = useStore((s) => s.info);
  const settings = useStore((s) => s.settings);
  const [phase, setPhase] = useState<Phase>('describe');
  const [description, setDescription] = useState('');
  const [parentDir, setParentDir] = useState('');
  const [folderName, setFolderName] = useState('');
  const [initGit, setInitGit] = useState(true);
  const [plan, setPlan] = useState<GamePlan | null>(null);
  const [feedback, setFeedback] = useState('');
  const [error, setError] = useState<UserFacingError | null>(null);
  const [steps, setSteps] = useState<Step[]>([]);
  const [files, setFiles] = useState(0);
  const [result, setResult] = useState<CreateGameView | null>(null);

  useEffect(() => {
    if (dialog.open) {
      setPhase('describe');
      setDescription(dialog.description ?? '');
      setPlan(null);
      setError(null);
      setSteps([]);
      setResult(null);
      setFeedback('');
      setFolderName('');
      if (!parentDir && info) setParentDir(info.defaultProjectsDir);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dialog.open]);

  useEffect(() => {
    if (phase !== 'generating') return;
    return on('event', (event) => {
      if (event.type === 'pipeline:step') {
        setSteps((prev) => {
          const index = prev.findIndex((s) => s.step === event.step);
          const next: Step = {
            step: event.step,
            label: event.label,
            agent: event.agent,
            status: event.status,
            ...(event.detail ? { detail: event.detail } : {}),
          };
          if (index === -1) return [...prev, next];
          const copy = [...prev];
          copy[index] = next;
          return copy;
        });
      } else if (event.type === 'pipeline:file') {
        setFiles((n) => n + 1);
      }
    });
  }, [phase]);

  if (!dialog.open) return null;

  const close = () => {
    if (phase === 'planning' || phase === 'generating') void call('ai:cancel');
    store.set((s) => ({ dialogs: { ...s.dialogs, create: { open: false } } }));
  };

  const generatePlan = async (previous?: GamePlan, change?: string) => {
    setError(null);
    setPhase('planning');
    try {
      const next = await call('ai:plan', description.trim(), previous, change);
      setPlan(next);
      setPhase('review');
    } catch (e) {
      setError(asUserError(e));
      setPhase(previous ? 'review' : 'describe');
    }
  };

  const approve = async () => {
    if (!plan) return;
    setError(null);
    setSteps([]);
    setFiles(0);
    setPhase('generating');
    try {
      const created = await call('ai:create', {
        plan,
        parentDir,
        ...(folderName.trim() ? { folderName: folderName.trim() } : {}),
        initGit,
      });
      setResult(created);
      setPhase('done');
      const project = await call('project:current');
      if (project) afterProjectOpened(project);
      if (created.changes.length) store.set({ changes: created.changes });
    } catch (e) {
      setError(asUserError(e));
      setPhase('review');
    }
  };

  const noProvider =
    !settings ||
    settings.activeLabel === 'No AI provider' ||
    settings.activeLabel.includes('not configured');

  const footer = (() => {
    switch (phase) {
      case 'describe':
        return (
          <>
            <button className="btn" onClick={close}>
              Cancel
            </button>
            <button
              className="btn primary"
              onClick={() => generatePlan()}
              disabled={description.trim().length < 3 || !parentDir}
              data-testid="generate-plan"
            >
              <Wand2 size={14} /> Generate plan
            </button>
          </>
        );
      case 'review':
        return (
          <>
            <button className="btn left" onClick={close} data-testid="plan-cancel">
              Cancel
            </button>
            <button className="btn" onClick={() => setPhase('edit')} data-testid="plan-edit">
              <Pencil size={13} /> Edit
            </button>
            <button className="btn" onClick={() => generatePlan()} data-testid="plan-regenerate">
              <RefreshCw size={13} /> Regenerate
            </button>
            <button className="btn primary" onClick={() => approve()} data-testid="plan-approve">
              <CheckCircle2 size={14} /> Approve
            </button>
          </>
        );
      case 'edit':
        return (
          <>
            <button className="btn" onClick={() => setPhase('review')}>
              Back
            </button>
            <button
              className="btn primary"
              onClick={() => generatePlan(plan ?? undefined, feedback.trim())}
              disabled={!feedback.trim()}
            >
              Update plan
            </button>
          </>
        );
      case 'done':
        return (
          <>
            {result && result.changes.length > 0 && (
              <button
                className="btn left"
                onClick={() => {
                  close();
                  reviewChanges();
                }}
              >
                Review AI changes ({result.changes.length})
              </button>
            )}
            <button className="btn" onClick={close}>
              Close
            </button>
            <button
              className="btn primary"
              onClick={() => {
                close();
                void runGame('play');
              }}
              data-testid="run-created-game"
            >
              <Play size={13} /> Run game
            </button>
          </>
        );
      default:
        return (
          <button className="btn" onClick={close}>
            Cancel
          </button>
        );
    }
  })();

  return (
    <Modal
      title="Create Game"
      icon={<Wand2 size={16} color="var(--accent)" />}
      onClose={close}
      footer={footer}
      size="wide"
      testId="create-dialog"
    >
      {error && (
        <div style={{ marginBottom: 14 }}>
          <ErrorCallout error={error} />
          {error.code === 'PROVIDER_NOT_CONFIGURED' && (
            <div className="row" style={{ marginTop: 8 }}>
              <button className="btn small" onClick={() => openSettings('ai')}>
                Open Settings → AI Provider
              </button>
              <button
                className="btn small"
                onClick={async () => {
                  await call('settings:save', { provider: 'mock' });
                  await refreshSettings();
                  setError(null);
                }}
              >
                Use the offline mock (no AI)
              </button>
            </div>
          )}
        </div>
      )}

      {phase === 'describe' && (
        <>
          <div className="field">
            <label htmlFor="game-description">Describe your game</label>
            <textarea
              id="game-description"
              className="textarea"
              style={{ minHeight: 110 }}
              autoFocus
              placeholder="e.g. A 3D horror game in an abandoned hospital. The player finds keys, opens doors and is hunted by a monster."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && description.trim().length >= 3)
                  void generatePlan();
              }}
              data-testid="game-description"
            />
            <div className="row wrap">
              {EXAMPLES.map((example) => (
                <button
                  key={example}
                  className="chip"
                  onClick={() => setDescription(example)}
                  title={example}
                >
                  {example.split('.')[0]!.slice(0, 48)}…
                </button>
              ))}
            </div>
          </div>
          <div className="row" style={{ alignItems: 'flex-end' }}>
            <div className="field grow">
              <label htmlFor="parent-dir">Location</label>
              <input
                id="parent-dir"
                className="input mono"
                value={parentDir}
                onChange={(e) => setParentDir(e.target.value)}
                data-testid="parent-dir"
              />
            </div>
            <button
              className="btn"
              style={{ marginBottom: 14 }}
              onClick={async () => {
                const folder = await call(
                  'dialog:select-folder',
                  'Where should the game be created?',
                );
                if (folder) setParentDir(folder);
              }}
            >
              <FolderOpen size={14} /> Browse
            </button>
            <div className="field" style={{ width: 200 }}>
              <label htmlFor="folder-name">Folder name (optional)</label>
              <input
                id="folder-name"
                className="input"
                placeholder="from the title"
                value={folderName}
                onChange={(e) => setFolderName(e.target.value)}
              />
            </div>
          </div>
          <label className="checkbox">
            <input
              type="checkbox"
              checked={initGit}
              onChange={(e) => setInitGit(e.target.checked)}
            />{' '}
            Initialize a Git repository
          </label>
          <p className="hint" style={{ marginTop: 12 }}>
            The Game Designer creates a plan first — nothing is generated until you approve it.
            Provider: {settings?.activeLabel ?? '…'}
            {noProvider ? ' — configure one in Settings.' : ''}
          </p>
        </>
      )}

      {phase === 'planning' && (
        <div className="empty" style={{ padding: 50 }}>
          <Spinner />
          <div style={{ color: 'var(--text)' }}>The Game Designer is planning your game…</div>
          <div>{settings?.activeLabel}</div>
        </div>
      )}

      {(phase === 'review' || phase === 'edit') && plan && (
        <>
          <PlanView plan={plan} />
          {phase === 'edit' && (
            <div className="field" style={{ marginTop: 16 }}>
              <label htmlFor="plan-feedback">What should change?</label>
              <textarea
                id="plan-feedback"
                className="textarea"
                autoFocus
                placeholder="e.g. Make it 2D, add a second enemy and 12 rooms."
                value={feedback}
                onChange={(e) => setFeedback(e.target.value)}
              />
            </div>
          )}
        </>
      )}

      {(phase === 'generating' || phase === 'done') && (
        <div data-testid="generation-progress">
          <div className="row" style={{ marginBottom: 10 }}>
            {phase === 'generating' ? <Spinner /> : <CheckCircle2 size={16} color="var(--green)" />}
            <strong>
              {phase === 'generating' ? `Building "${plan?.title}"…` : `"${plan?.title}" is ready`}
            </strong>
            <span className="faint">{files} files</span>
          </div>
          {steps.map((step) => (
            <div key={step.step} className="step-line">
              {step.status === 'running' ? (
                <Spinner />
              ) : step.status === 'done' ? (
                <CheckCircle2 size={14} color="var(--green)" />
              ) : step.status === 'failed' ? (
                <XCircle size={14} color="var(--red)" />
              ) : (
                <CircleDashed size={14} color="var(--text-faint)" />
              )}
              <span className="agent">{step.agent}</span>
              <span>
                {step.label}
                {step.detail && <div className="detail">{step.detail}</div>}
              </span>
            </div>
          ))}
          {result && (
            <div className="callout success" style={{ marginTop: 14 }}>
              <CheckCircle2 size={16} color="var(--green)" />
              <div>
                <div className="title">Created {result.files} files</div>
                <div className="mono" style={{ fontSize: 12 }}>
                  {result.root}
                </div>
                {result.tests && (
                  <div>
                    Tests: {result.tests.passed}/{result.tests.total} passed
                  </div>
                )}
                {result.customFeatures.length > 0 && (
                  <div className="muted">Custom features: {result.customFeatures.join(', ')}</div>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
