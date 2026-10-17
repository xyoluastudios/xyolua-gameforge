import { CheckCircle2, ListChecks, RefreshCw, ShieldCheck, Wrench } from 'lucide-react';
import { useState } from 'react';
import type { FixPlan, FixResultView, IssueSeverity, ProjectIssue } from '@shared/api';
import { call } from '../api';
import { analyze, openFile, reviewChanges, showError, toast } from '../actions';
import { useStore } from '../store';
import { ScoreBar, Spinner } from './ui';

const SEVERITY_LABEL: Record<IssueSeverity, string> = {
  critical: 'Critical',
  high: 'High',
  medium: 'Medium',
  low: 'Low',
  info: 'Info',
};
const ORDER: IssueSeverity[] = ['critical', 'high', 'medium', 'low', 'info'];

type Stage =
  | { kind: 'idle' }
  | { kind: 'planning' }
  | { kind: 'plan'; plan: FixPlan }
  | { kind: 'applying'; plan: FixPlan }
  | { kind: 'done'; result: FixResultView };

export function AnalysisView() {
  const report = useStore((s) => s.analysis);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [stage, setStage] = useState<Stage>({ kind: 'idle' });
  const [validating, setValidating] = useState(false);

  if (!report) {
    return (
      <div className="workspace-body">
        <div className="empty">
          <Spinner /> Analyzing project…
        </div>
      </div>
    );
  }

  const counts = ORDER.map(
    (sev) => [sev, report.issues.filter((i) => i.severity === sev).length] as const,
  );
  const critical = report.issues.filter((i) => i.severity === 'critical');

  const plan = async (filter: { severities?: IssueSeverity[]; issueIds?: string[] }) => {
    setStage({ kind: 'planning' });
    try {
      setStage({ kind: 'plan', plan: await call('analysis:fix-plan', filter) });
    } catch (error) {
      showError(error);
      setStage({ kind: 'idle' });
    }
  };

  const apply = async (fixPlan: FixPlan) => {
    setStage({ kind: 'applying', plan: fixPlan });
    try {
      const result = await call('analysis:apply-fix-plan', fixPlan);
      setStage({ kind: 'done', result });
      if (result.changes.length) reviewChanges();
      else toast('info', 'No files were changed');
    } catch (error) {
      showError(error, 'Fixing failed');
      setStage({ kind: 'plan', plan: fixPlan });
    }
  };

  const validate = async () => {
    setValidating(true);
    try {
      const result = await call('analysis:validate');
      if (!result.engineAvailable)
        toast('warn', 'Godot not detected', 'Install Godot or set its path in Settings → Godot.');
      else if (result.ok) toast('success', 'Godot loaded every script and scene without errors');
      else
        toast(
          'error',
          `Godot reported ${result.errors.length} error(s)`,
          result.errors
            .slice(0, 3)
            .map((e) => `${e.file ?? ''}${e.line ? `:${e.line}` : ''} ${e.message}`)
            .join('\n'),
        );
    } catch (error) {
      showError(error, 'Validation failed');
    } finally {
      setValidating(false);
    }
  };

  const toggle = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  };

  return (
    <div className="workspace-body" data-testid="analysis-view">
      <div className="toolbar">
        <span className="title">Project Analysis</span>
        <span className="muted">{report.projectName}</span>
        <span className="grow" />
        <button className="btn small" onClick={() => analyze()}>
          <RefreshCw size={13} /> Re-analyze
        </button>
        <button
          className="btn small"
          onClick={() => validate()}
          disabled={validating}
          title="Load every script and scene in Godot (runs project code)"
        >
          {validating ? <Spinner /> : <ShieldCheck size={13} />} Validate with Godot
        </button>
        <button
          className="btn small"
          onClick={() => plan({ issueIds: [...selected] })}
          disabled={selected.size === 0}
        >
          <ListChecks size={13} /> Fix selected ({selected.size})
        </button>
        <button
          className="btn small primary"
          onClick={() => plan({ severities: ['critical'] })}
          disabled={critical.length === 0}
          data-testid="fix-critical"
        >
          <Wrench size={13} /> Fix Critical Issues
        </button>
      </div>
      <div className="scroll" style={{ flex: 1 }}>
        <div className="scores">
          {(
            [
              ['Architecture', report.scores.architecture],
              ['Code Quality', report.scores.codeQuality],
              ['Testing', report.scores.testing],
              ['Documentation', report.scores.documentation],
            ] as const
          ).map(([label, value]) => (
            <div className="score-card" key={label}>
              <div className="label muted">{label}</div>
              <div className="value">
                {value}
                <small>/100</small>
              </div>
              <ScoreBar value={value} />
            </div>
          ))}
        </div>
        <div className="row muted" style={{ padding: '0 14px 10px', fontSize: 12 }}>
          {report.stats.scripts} scripts · {report.stats.scenes} scenes · {report.stats.assets}{' '}
          assets · {report.stats.linesOfCode} lines · {report.stats.tests} test files
          <span className="grow" />
          <strong style={{ color: 'var(--text)' }}>Issues found: {report.issues.length}</strong>
          {counts
            .filter(([, n]) => n > 0)
            .map(([sev, n]) => (
              <span key={sev} className="row" style={{ gap: 4 }}>
                <span
                  className={`sev ${sev}`}
                  style={{ width: 8, height: 8, borderRadius: 4, display: 'inline-block' }}
                />{' '}
                {n} {SEVERITY_LABEL[sev].toLowerCase()}
              </span>
            ))}
        </div>

        {stage.kind !== 'idle' && (
          <div className="card" style={{ margin: '0 14px 12px' }} data-testid="fix-plan">
            {stage.kind === 'planning' && (
              <div className="row">
                <Spinner /> Creating fix plan…
              </div>
            )}
            {(stage.kind === 'plan' || stage.kind === 'applying') && (
              <>
                <div className="card-title">
                  <Wrench size={14} /> Fix plan — {stage.plan.items.length} issue
                  {stage.plan.items.length === 1 ? '' : 's'}
                </div>
                {stage.plan.items.map((item) => (
                  <div
                    key={item.issue.id}
                    className="row"
                    style={{ padding: '3px 0', fontSize: 12.5 }}
                  >
                    <span
                      className={`sev ${item.issue.severity}`}
                      style={{ width: 8, height: 8, borderRadius: 4 }}
                    />
                    <span className="grow ellipsis">
                      {item.issue.title}
                      <span className="faint">
                        {' '}
                        {item.issue.file
                          ? `· ${item.issue.file}${item.issue.line ? `:${item.issue.line}` : ''}`
                          : ''}
                      </span>
                    </span>
                    <span
                      className={`badge ${item.strategy === 'auto' ? 'green' : item.strategy === 'ai' ? 'blue' : ''}`}
                    >
                      {item.strategy === 'auto'
                        ? 'quick fix'
                        : item.strategy === 'ai'
                          ? 'AI'
                          : 'manual'}
                    </span>
                  </div>
                ))}
                {!stage.plan.aiAvailable &&
                  stage.plan.items.some((i) => i.strategy === 'manual') && (
                    <p className="hint">
                      Some issues need a generative AI provider (Settings → AI Provider) or a manual
                      fix.
                    </p>
                  )}
                <div className="row" style={{ marginTop: 10 }}>
                  <span className="hint grow">
                    Fixes are staged — you review the diff before anything is written.
                  </span>
                  <button
                    className="btn small"
                    onClick={() => setStage({ kind: 'idle' })}
                    disabled={stage.kind === 'applying'}
                  >
                    Cancel
                  </button>
                  <button
                    className="btn small primary"
                    onClick={() => apply(stage.plan)}
                    disabled={
                      stage.kind === 'applying' ||
                      !stage.plan.items.some((i) => i.strategy !== 'manual')
                    }
                    data-testid="apply-fix-plan"
                  >
                    {stage.kind === 'applying' ? <Spinner /> : null} Apply fixes
                  </button>
                </div>
              </>
            )}
            {stage.kind === 'done' && (
              <div className="row">
                <CheckCircle2 size={16} color="var(--green)" />
                <span className="grow">
                  Resolved {stage.result.resolved.length} issue(s), {stage.result.remaining}{' '}
                  remaining · {stage.result.changes.length} file(s) changed
                  {stage.result.aiSummary ? (
                    <div className="hint">{stage.result.aiSummary.slice(0, 300)}</div>
                  ) : null}
                </span>
                {stage.result.changes.length > 0 && (
                  <button className="btn small primary" onClick={() => reviewChanges()}>
                    Review diff
                  </button>
                )}
                <button className="btn small" onClick={() => setStage({ kind: 'idle' })}>
                  Close
                </button>
              </div>
            )}
          </div>
        )}

        {report.issues.length === 0 ? (
          <div className="empty">
            <CheckCircle2 size={22} color="var(--green)" /> No issues found.
          </div>
        ) : (
          report.issues.map((issue: ProjectIssue) => (
            <div className="issue" key={issue.id}>
              <input
                type="checkbox"
                checked={selected.has(issue.id)}
                onChange={() => toggle(issue.id)}
                aria-label={`Select ${issue.title}`}
                style={{ marginTop: 3, accentColor: 'var(--accent)' }}
              />
              <span className={`sev ${issue.severity}`} title={SEVERITY_LABEL[issue.severity]} />
              <div className="grow" style={{ minWidth: 0 }}>
                <div className="row">
                  <span className="t">{issue.title}</span>
                  {issue.file && (
                    <span className="loc" onClick={() => openFile(issue.file!, issue.line)}>
                      {issue.file}
                      {issue.line ? `:${issue.line}` : ''}
                    </span>
                  )}
                </div>
                <div className="m">{issue.message}</div>
              </div>
              {issue.fix && (
                <span className={`badge ${issue.fix.kind === 'auto' ? 'green' : 'blue'}`}>
                  {issue.fix.kind === 'auto' ? 'quick fix' : 'AI fix'}
                </span>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
