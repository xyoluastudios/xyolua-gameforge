import {
  CheckCircle2,
  CircleDashed,
  GitBranch,
  GitCommitHorizontal,
  Play,
  RefreshCw,
  Trash2,
  UploadCloud,
  X,
  XCircle,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { GitCommit, GitStatus } from '@shared/api';
import { call } from '../api';
import { appendOutput, openFile, openTab, runTests, setLayout, showError, toast } from '../actions';
import { store, useStore, type BottomTab } from '../store';
import { Spinner } from './ui';

function Terminal() {
  const output = useStore((s) => s.output);
  const project = useStore((s) => s.project);
  const [command, setCommand] = useState('');
  const [running, setRunning] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    box.current?.scrollTo({ top: box.current.scrollHeight });
  }, [output]);

  const run = async () => {
    if (!command.trim() || running) return;
    appendOutput('terminal', 'cmd', `$ ${command}`);
    setRunning(true);
    const text = command;
    setCommand('');
    try {
      const result = await call('terminal:run', text);
      appendOutput(
        'terminal',
        result.exitCode === 0 ? 'stdout' : 'stderr',
        `exit code ${result.exitCode ?? 'killed'}${result.timedOut ? ' (timed out)' : ''}`,
      );
    } catch (error) {
      const e = showError(error, 'Command failed');
      appendOutput('terminal', 'stderr', [e.message, e.reason].filter(Boolean).join(' — '));
    } finally {
      setRunning(false);
    }
  };

  return (
    <>
      <div className="console" ref={box} data-testid="terminal-output">
        {output.length === 0 && (
          <span className="faint">Game, test and command output appears here.</span>
        )}
        {output.map((line) => (
          <div
            key={line.id}
            className={line.stream === 'stderr' ? 'stderr' : line.stream === 'cmd' ? 'cmd' : ''}
          >
            <span className="src">[{line.source}] </span>
            {line.text}
          </div>
        ))}
      </div>
      <div className="console-input">
        <span className="muted">{running ? <Spinner /> : '$'}</span>
        <input
          value={command}
          onChange={(e) => setCommand(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && run()}
          placeholder={
            project
              ? 'Run a command in the project folder (no shell: one program per line)'
              : 'Open a project to run commands'
          }
          disabled={!project || running}
          aria-label="Terminal command"
        />
        <button className="icon-btn" title="Clear" onClick={() => store.set({ output: [] })}>
          <Trash2 size={13} />
        </button>
      </div>
    </>
  );
}

function Logs() {
  const logs = useStore((s) => s.logs);
  const [level, setLevel] = useState<'all' | 'warn' | 'error'>('all');
  const box = useRef<HTMLDivElement>(null);
  const shown = logs.filter(
    (l) =>
      level === 'all' ||
      (level === 'warn' ? l.level === 'warn' || l.level === 'error' : l.level === 'error'),
  );
  useEffect(() => {
    box.current?.scrollTo({ top: box.current.scrollHeight });
  }, [shown.length]);
  return (
    <>
      <div className="row" style={{ padding: '4px 12px', borderBottom: '1px solid var(--border)' }}>
        <select
          className="select"
          style={{ width: 140, padding: '2px 6px' }}
          value={level}
          onChange={(e) => setLevel(e.target.value as typeof level)}
        >
          <option value="all">All levels</option>
          <option value="warn">Warnings & errors</option>
          <option value="error">Errors</option>
        </select>
        <span className="hint">
          Debug details are only shown here and in the log file, never in dialogs.
        </span>
      </div>
      <div className="console" ref={box} style={{ padding: '4px 0' }}>
        {shown.map((entry, index) => (
          <div key={index} className="log-row" title={entry.details}>
            <span className="time">{entry.time.slice(11, 19)}</span>
            <span className={`lvl ${entry.level}`}>{entry.level}</span>
            <span className="scope">{entry.scope}</span>
            <span>{entry.message}</span>
          </div>
        ))}
      </div>
    </>
  );
}

function Tests() {
  const tests = useStore((s) => s.tests);
  const running = useStore((s) => s.testsRunning);
  const project = useStore((s) => s.project);
  return (
    <div className="scroll" style={{ flex: 1 }}>
      <div className="row" style={{ padding: '6px 12px', borderBottom: '1px solid var(--border)' }}>
        <button
          className="btn small primary"
          onClick={() => runTests()}
          disabled={!project || running}
          data-testid="run-tests"
        >
          {running ? <Spinner /> : <Play size={12} />} Run tests
        </button>
        {tests && !tests.error && (
          <span className={tests.ok ? 'add' : 'del'}>
            {tests.ok ? 'PASSED' : 'FAILED'} — {tests.passed} passed, {tests.failed} failed,{' '}
            {tests.skipped} skipped · {(tests.durationMs / 1000).toFixed(1)}s · {tests.runner}
          </span>
        )}
        {tests?.error && (
          <span className="muted">
            {tests.error.message} {tests.error.solution}
          </span>
        )}
      </div>
      {!tests && !running && <div className="empty">Run the project tests headless in Godot.</div>}
      {tests?.results.map((result) => (
        <div
          key={result.name}
          className="list-row"
          style={{ paddingLeft: 12, cursor: result.file ? 'pointer' : 'default' }}
          onClick={() => result.file && openFile(result.file)}
        >
          {result.status === 'passed' ? (
            <CheckCircle2 size={13} color="var(--green)" />
          ) : result.status === 'failed' ? (
            <XCircle size={13} color="var(--red)" />
          ) : (
            <CircleDashed size={13} color="var(--text-faint)" />
          )}
          <span className="mono" style={{ fontSize: 12 }}>
            {result.name}
          </span>
          {result.message && (
            <span className={result.status === 'failed' ? 'del' : 'faint'}>{result.message}</span>
          )}
        </div>
      ))}
    </div>
  );
}

function Git() {
  const project = useStore((s) => s.project);
  const [status, setStatus] = useState<GitStatus | null>(null);
  const [log, setLog] = useState<GitCommit[]>([]);
  const [message, setMessage] = useState('');
  const [branch, setBranch] = useState('');
  const [busy, setBusy] = useState(false);

  const refresh = async () => {
    if (!project) return;
    try {
      const next = await call('git:status');
      setStatus(next);
      if (next.isRepo) setLog(await call('git:log'));
    } catch (error) {
      showError(error, 'Git');
    }
  };
  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project?.root]);

  const act = async (fn: () => Promise<unknown>, success?: string) => {
    setBusy(true);
    try {
      await fn();
      if (success) toast('success', success);
      await refresh();
    } catch (error) {
      showError(error);
    } finally {
      setBusy(false);
    }
  };

  if (!project) return <div className="empty">Open a project to use Git.</div>;
  if (!status)
    return (
      <div className="empty">
        <Spinner />
      </div>
    );
  if (!status.isRepo) {
    return (
      <div className="empty">
        This project is not a Git repository.
        <button
          className="btn small primary"
          onClick={() => act(() => call('git:init'), 'Repository initialized')}
        >
          Initialize repository
        </button>
      </div>
    );
  }
  return (
    <div className="split" style={{ flex: 1 }}>
      <div className="list" style={{ width: 360 }}>
        <div
          className="row"
          style={{ padding: '6px 10px', borderBottom: '1px solid var(--border)' }}
        >
          <GitBranch size={13} />
          <strong>{status.branch ?? '(detached)'}</strong>
          {status.upstream && <span className="faint">→ {status.upstream}</span>}
          {(status.ahead > 0 || status.behind > 0) && (
            <span className="faint">
              ↑{status.ahead} ↓{status.behind}
            </span>
          )}
          <span className="grow" />
          <button className="icon-btn" onClick={() => refresh()} title="Refresh">
            <RefreshCw size={13} />
          </button>
        </div>
        {status.files.length === 0 && (
          <div className="empty" style={{ padding: 14 }}>
            Working tree clean.
          </div>
        )}
        {status.files.map((file) => (
          <div
            key={file.path}
            className="change-row"
            onClick={() =>
              openTab({
                id: `git:${file.path}`,
                kind: 'git-diff',
                title: `Δ ${file.path.split('/').pop()}`,
                path: file.path,
              })
            }
          >
            <span
              className={`kind ${file.kind === 'untracked' || file.kind === 'added' ? 'create' : file.kind === 'deleted' ? 'delete' : 'modify'}`}
            >
              {file.untracked ? 'U' : file.code.trim()[0]}
            </span>
            <span className="ellipsis grow mono" style={{ fontSize: 12 }}>
              {file.path}
            </span>
            {!file.untracked && (
              <button
                className="icon-btn"
                title="Discard local changes"
                onClick={(e) => {
                  e.stopPropagation();
                  if (window.confirm(`Discard your changes to ${file.path}?`))
                    void act(() => call('git:discard', [file.path]), 'Changes discarded');
                }}
              >
                <X size={12} />
              </button>
            )}
          </div>
        ))}
        <div style={{ padding: 10, borderTop: '1px solid var(--border)' }}>
          <textarea
            className="textarea"
            style={{ minHeight: 52 }}
            placeholder="Commit message"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            aria-label="Commit message"
          />
          <div className="row" style={{ marginTop: 6 }}>
            <button
              className="btn small primary"
              disabled={busy || !message.trim() || status.files.length === 0}
              onClick={() =>
                act(async () => {
                  await call('git:commit', message);
                  setMessage('');
                }, 'Committed')
              }
            >
              <GitCommitHorizontal size={13} /> Commit all
            </button>
            <button
              className="btn small"
              disabled={busy}
              title="Push requires your explicit action — GameForge never pushes on its own"
              onClick={() => {
                if (
                  window.confirm(
                    `Push ${status.branch ?? 'this branch'} to its remote? This publishes your commits.`,
                  )
                )
                  void act(() => call('git:push'), 'Pushed');
              }}
            >
              <UploadCloud size={13} /> Push
            </button>
          </div>
          <div className="row" style={{ marginTop: 8 }}>
            <input
              className="input"
              style={{ padding: '3px 8px' }}
              placeholder="new-branch-name"
              value={branch}
              onChange={(e) => setBranch(e.target.value)}
              aria-label="Branch name"
            />
            <button
              className="btn small"
              disabled={busy || !branch.trim()}
              onClick={() =>
                act(async () => {
                  await call('git:create-branch', branch.trim());
                  setBranch('');
                }, 'Branch created')
              }
            >
              Branch
            </button>
          </div>
        </div>
      </div>
      <div className="detail">
        <div className="panel-header">History</div>
        {log.length === 0 && <div className="empty">No commits yet.</div>}
        {log.map((commit) => (
          <div key={commit.hash} className="row" style={{ padding: '3px 12px', fontSize: 12.5 }}>
            <span className="mono faint">{commit.shortHash}</span>
            <span className="grow ellipsis">{commit.subject}</span>
            <span className="faint">{commit.author}</span>
            <span className="faint">{new Date(commit.date).toLocaleDateString()}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function Problems() {
  const analysis = useStore((s) => s.analysis);
  if (!analysis)
    return <div className="empty">Analyze the project (Ctrl+Shift+A) to list problems.</div>;
  return (
    <div className="scroll" style={{ flex: 1 }}>
      {analysis.issues.map((issue) => (
        <div
          key={issue.id}
          className="list-row"
          style={{ paddingLeft: 12 }}
          onClick={() => issue.file && openFile(issue.file, issue.line)}
        >
          <span
            className={`sev ${issue.severity}`}
            style={{ width: 8, height: 8, borderRadius: 4, flexShrink: 0 }}
          />
          <span>{issue.title}</span>
          <span className="faint ellipsis">{issue.message}</span>
          <span className="meta mono">
            {issue.file ? `${issue.file}${issue.line ? `:${issue.line}` : ''}` : ''}
          </span>
        </div>
      ))}
    </div>
  );
}

export function BottomPanel() {
  const tab = useStore((s) => s.layout.bottomTab);
  const problems = useStore(
    (s) =>
      s.analysis?.issues.filter((i) => i.severity === 'critical' || i.severity === 'high').length ??
      0,
  );
  const errors = useStore((s) => s.logs.filter((l) => l.level === 'error').length);
  const tests = useStore((s) => s.tests);
  const tabs = useMemo<[BottomTab, string, React.ReactNode?][]>(
    () => [
      ['terminal', 'Terminal'],
      ['logs', 'Logs', errors ? <span className="badge red">{errors}</span> : null],
      [
        'tests',
        'Tests',
        tests ? (
          <span className={`badge ${tests.ok ? 'green' : 'red'}`}>
            {tests.passed}/{tests.total}
          </span>
        ) : null,
      ],
      ['git', 'Git'],
      ['problems', 'Problems', problems ? <span className="badge red">{problems}</span> : null],
    ],
    [errors, tests, problems],
  );
  return (
    <div className="bottom-panel" style={{ height: '100%' }} data-testid="bottom-panel">
      <div className="subtabs">
        {tabs.map(([id, label, badge]) => (
          <button
            key={id}
            className={`subtab ${tab === id ? 'active' : ''}`}
            onClick={() => setLayout({ bottomTab: id })}
          >
            {label}
            {badge}
          </button>
        ))}
        <span className="grow" />
        <button
          className="icon-btn"
          onClick={() => setLayout({ bottom: false })}
          title="Close panel (Ctrl+J)"
        >
          <X size={14} />
        </button>
      </div>
      {tab === 'terminal' && <Terminal />}
      {tab === 'logs' && <Logs />}
      {tab === 'tests' && <Tests />}
      {tab === 'git' && <Git />}
      {tab === 'problems' && <Problems />}
    </div>
  );
}
