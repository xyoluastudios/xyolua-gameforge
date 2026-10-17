import { z } from 'zod';
import type { GameForge } from './app.js';
import type { AgentDefinition, AgentId } from './agents/definitions.js';
import { runAgent, type AgentRunResult } from './agents/runner.js';
import {
  SEVERITY_ORDER,
  type AnalysisReport,
  type EngineAdapter,
  type IssueSeverity,
  type ProjectIssue,
  type RunningGame,
  type TestRunReport,
  type ValidationResult,
} from './engines/types.js';
import { GameForgeError, toUserError } from './errors.js';
import type { GameForgeEvent, GameForgeEventListener } from './events-types.js';
import { PermissionManager } from './permissions/permissions.js';
import type { AIProvider, ChatMessage } from './providers/types.js';
import { defineTool, type ToolContext } from './tools/types.js';
import type { ChangeSummary, FileChange } from './workspace/changeset.js';
import type { Workspace } from './workspace/workspace.js';

export interface SessionRunOptions {
  signal?: AbortSignal;
  onEvent?: GameForgeEventListener;
}

export interface AgentTaskOptions extends SessionRunOptions {
  /** staged = review before writing to disk (default from settings). */
  mode?: 'staged' | 'direct';
  history?: ChatMessage[];
}

export type ChatOutcome =
  | { kind: 'agent'; result: AgentRunResult; changes: ChangeSummary[] }
  | { kind: 'action'; action: 'run-tests'; report: TestRunReport }
  | { kind: 'action'; action: 'run-game' }
  | { kind: 'action'; action: 'analyze'; report: AnalysisReport }
  | { kind: 'action'; action: 'fix-plan'; plan: FixPlan; report: AnalysisReport }
  | { kind: 'action'; action: 'git-status'; text: string }
  | { kind: 'action'; action: 'create-game'; description: string };

export interface FixPlanItem {
  issue: ProjectIssue;
  strategy: 'auto' | 'ai' | 'manual';
  description: string;
}

export interface FixPlan {
  items: FixPlanItem[];
  aiAvailable: boolean;
}

export interface FixResult {
  autoFixed: string[];
  aiRun: AgentRunResult | null;
  resolved: string[];
  remaining: ProjectIssue[];
  changes: ChangeSummary[];
}

export interface ValidationOutcome extends ValidationResult {
  fixRounds: number;
}

export type Intent = 'run-game' | 'run-tests' | 'analyze' | 'fix' | 'git-status' | 'create-game';

/** Detects requests that GameForge handles directly, without an AI round-trip. */
export function detectIntent(message: string): Intent | null {
  const text = message.trim().toLowerCase();
  if (/^(please\s+)?(run|start|play|launch)\s+(the\s+)?(game|project)\b/.test(text))
    return 'run-game';
  if (/^(please\s+)?(run|execute)\s+(all\s+)?(the\s+)?tests?\b/.test(text) || text === 'test')
    return 'run-tests';
  if (/^(please\s+)?(analy[sz]e|scan)\b(?!.*\b(error|this|script)\b)/.test(text)) return 'analyze';
  if (
    /^(please\s+)?(fix|repair)\s+(all\s+)?(the\s+)?(critical\s+|high\s+)?(issues|problems|bugs|errors)\b/.test(
      text,
    )
  )
    return 'fix';
  if (/^git\s+status\b/.test(text)) return 'git-status';
  if (/^(create|make|build)\s+(a|an|my)\s+.*\b(game)\b/.test(text)) return 'create-game';
  return null;
}

/** An open project: sandboxed workspace, permissions, engine and agents. */
export class ProjectSession {
  readonly root: string;
  readonly workspace: Workspace;
  readonly userWorkspace: Workspace;
  readonly permissions: PermissionManager;
  private runningGame: RunningGame | null = null;
  private lastReport: AnalysisReport | null = null;

  constructor(
    readonly app: GameForge,
    workspace: Workspace,
    readonly engine: EngineAdapter | null,
  ) {
    this.root = workspace.root;
    this.workspace = workspace;
    this.userWorkspace = workspace.withPolicy('user');
    this.permissions = new PermissionManager({
      root: this.root,
      grants: app.grants,
      confirm: (request) => app.confirm(request),
      godotExecutables: () => {
        const exe = app.settings.godot.executable ?? app.env.GODOT_PATH;
        return exe ? [exe] : [];
      },
      logger: app.logger.child('permissions'),
    });
  }

  get name(): string {
    return this.root.split(/[\\/]/).pop() ?? this.root;
  }

  get gameRunning(): boolean {
    return this.runningGame !== null;
  }

  get lastAnalysis(): AnalysisReport | null {
    return this.lastReport;
  }

  toolContext(
    options: { signal?: AbortSignal; onEvent?: GameForgeEventListener } = {},
  ): Omit<ToolContext, 'actor'> {
    return {
      workspace: this.workspace,
      permissions: this.permissions,
      git: this.app.git,
      engine: this.engine,
      logger: this.app.logger.child('agent'),
      ...(options.signal ? { signal: options.signal } : {}),
      onOutput: (stream, text) =>
        options.onEvent?.({ type: 'output', source: 'command', stream, text }),
    };
  }

  private extraSystem(): string {
    const parts = [`Project root: ${this.name}`];
    if (this.engine) parts.push(`Engine: ${this.engine.displayName}`, this.engine.agentGuide);
    return parts.join('\n');
  }

  private agentDefinition(id: string): AgentDefinition {
    const agent = this.app.agents().find((a) => a.id === id);
    if (!agent) throw new GameForgeError('INVALID_INPUT', `Unknown agent "${id}".`);
    return agent;
  }

  private ensureChanges(mode: 'staged' | 'direct'): void {
    const current = this.workspace.changes;
    if (!current) this.workspace.beginChanges(mode);
    else if (current.mode !== mode && current.size === 0) {
      this.workspace.beginChanges(mode);
    }
  }

  private requireProvider(): AIProvider {
    const provider = this.app.createProvider();
    return provider;
  }

  /** Runs a single agent on a task. Changes are tracked for review. */
  async runAgent(
    agentId: AgentId | string,
    task: string,
    options: AgentTaskOptions = {},
  ): Promise<AgentRunResult> {
    const provider = this.requireProvider();
    const settings = this.app.settings;
    this.ensureChanges(options.mode ?? settings.agents.changeMode);
    const agent = this.agentDefinition(agentId);
    return runAgent({
      agent,
      task,
      provider,
      tools: this.app.tools,
      toolContext: this.toolContext(options),
      extraSystem: this.extraSystem(),
      ...(options.history ? { history: options.history } : {}),
      maxSteps: Math.min(agent.maxSteps, settings.agents.maxSteps),
      ...(options.signal ? { signal: options.signal } : {}),
      ...(options.onEvent ? { onEvent: options.onEvent } : {}),
    });
  }

  /**
   * Handles a chat message: built-in actions run directly, everything else
   * goes to the Project Manager, who delegates to specialist agents.
   */
  async chat(message: string, options: AgentTaskOptions = {}): Promise<ChatOutcome> {
    const intent = detectIntent(message);
    switch (intent) {
      case 'run-tests':
        return { kind: 'action', action: 'run-tests', report: await this.runTests(options) };
      case 'run-game':
        await this.runGame('play', options);
        return { kind: 'action', action: 'run-game' };
      case 'analyze':
        return { kind: 'action', action: 'analyze', report: await this.analyze(options) };
      case 'fix': {
        const report = await this.analyze(options);
        const critical = /critical/i.test(message);
        const plan = this.createFixPlan(report, critical ? { severities: ['critical'] } : {});
        return { kind: 'action', action: 'fix-plan', plan, report };
      }
      case 'git-status': {
        const status = await this.app.git.status(this.root);
        const text = !status.isRepo
          ? 'This project is not a git repository.'
          : [
              `On branch ${status.branch ?? '(detached)'}`,
              ...(status.files.length
                ? status.files.map((f) => `${f.code} ${f.path}`)
                : ['Working tree clean.']),
            ].join('\n');
        return { kind: 'action', action: 'git-status', text };
      }
      case 'create-game':
        return { kind: 'action', action: 'create-game', description: message };
      default:
        break;
    }

    const provider = this.requireProvider();
    const settings = this.app.settings;
    this.ensureChanges(options.mode ?? settings.agents.changeMode);
    const orchestrator = this.agentDefinition('orchestrator');
    const specialists = this.app
      .agents()
      .filter((a) => a.id !== 'orchestrator' && a.id !== 'game-designer');
    const ids = specialists.map((a) => a.id) as [string, ...string[]];
    let parentRunId: string | undefined;

    const delegate = defineTool({
      name: 'delegate',
      description: `Assign a self-contained task to a specialist agent and receive its report. Agents: ${specialists
        .map((a) => `${a.id} (${a.description})`)
        .join('; ')}`,
      access: 'write',
      input: z.object({ agent: z.enum(ids), task: z.string().min(10) }),
      run: async (input) => {
        const agent = this.agentDefinition(input.agent);
        const result = await runAgent({
          agent,
          task: input.task,
          provider,
          tools: this.app.tools,
          toolContext: this.toolContext(options),
          extraSystem: this.extraSystem(),
          maxSteps: Math.min(agent.maxSteps, settings.agents.maxSteps),
          ...(parentRunId ? { parentRunId } : {}),
          ...(options.signal ? { signal: options.signal } : {}),
          ...(options.onEvent ? { onEvent: options.onEvent } : {}),
        });
        return { output: `[${agent.name} — ${result.status}]\n${result.summary}` };
      },
    });

    const result = await runAgent({
      agent: orchestrator,
      task: message,
      provider,
      tools: this.app.tools,
      extraTools: [delegate],
      toolContext: this.toolContext(options),
      extraSystem: this.extraSystem(),
      ...(options.history ? { history: options.history } : {}),
      maxSteps: Math.min(orchestrator.maxSteps, settings.agents.maxSteps),
      ...(options.signal ? { signal: options.signal } : {}),
      onEvent: (event) => {
        if (event.type === 'agent:start' && !event.parentRunId && !parentRunId)
          parentRunId = event.runId;
        options.onEvent?.(event);
      },
    });
    return { kind: 'agent', result, changes: this.pendingChanges() };
  }

  /** "AI edit" from the editor: change one file according to an instruction. */
  async aiEdit(
    file: string,
    instruction: string,
    selection?: { startLine: number; endLine: number; text: string },
    options: SessionRunOptions = {},
  ): Promise<AgentRunResult> {
    const rel = this.workspace.resolve(file).rel;
    const task = [
      `Edit ${rel}: ${instruction}`,
      selection
        ? `The user selected lines ${selection.startLine}-${selection.endLine}:\n\`\`\`\n${selection.text}\n\`\`\``
        : '',
      'Only change this file unless another change is strictly necessary.',
    ]
      .filter(Boolean)
      .join('\n\n');
    return this.runAgent('programmer', task, { ...options, mode: 'staged' });
  }

  // ------------------------------------------------------------ changes

  pendingChanges(): ChangeSummary[] {
    return this.workspace.changes?.summary() ?? [];
  }

  getChange(path: string): FileChange | undefined {
    return this.workspace.changes?.get(path);
  }

  diff(path?: string): string {
    return this.workspace.changes?.diff(path) ?? '';
  }

  async applyChanges(paths?: string[]): Promise<FileChange[]> {
    const applied = await this.workspace.applyChanges(paths);
    this.app.logger.info(`Applied ${applied.length} change(s) in ${this.name}`);
    return applied;
  }

  async discardChanges(paths?: string[]): Promise<FileChange[]> {
    const discarded = await this.workspace.discardChanges(paths);
    this.app.logger.info(`Discarded ${discarded.length} change(s) in ${this.name}`);
    return discarded;
  }

  // ------------------------------------------------------------ analysis & fixes

  private requireEngine(): EngineAdapter {
    if (!this.engine) {
      throw new GameForgeError(
        'ENGINE_NOT_SUPPORTED',
        'This folder is not a supported game project.',
        {
          reason: 'No project.godot was found.',
          solution: 'Open a Godot 4 project folder (the one containing project.godot).',
        },
      );
    }
    return this.engine;
  }

  async analyze(options: SessionRunOptions = {}): Promise<AnalysisReport> {
    const engine = this.requireEngine();
    const report = await engine.analyze(this.workspace, {
      logger: this.app.logger.child('analyze'),
      ...(options.signal ? { signal: options.signal } : {}),
    });
    report.issues.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
    this.lastReport = report;
    return report;
  }

  /** Prioritized fix plan. Nothing is changed until `applyFixPlan`. */
  createFixPlan(
    report: AnalysisReport,
    filter: { severities?: IssueSeverity[]; issueIds?: string[] } = {},
  ): FixPlan {
    const generative = (() => {
      try {
        return this.app.createProvider().capabilities.generative;
      } catch {
        return false;
      }
    })();
    const selected = report.issues.filter((issue) => {
      if (filter.issueIds) return filter.issueIds.includes(issue.id);
      if (filter.severities) return filter.severities.includes(issue.severity);
      return issue.severity !== 'info';
    });
    const items: FixPlanItem[] = selected
      .sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity])
      .map((issue) => {
        if (issue.fix?.kind === 'auto')
          return { issue, strategy: 'auto', description: issue.fix.description };
        if (issue.fix?.kind === 'ai' || issue.category !== 'documentation') {
          return generative
            ? {
                issue,
                strategy: 'ai',
                description: issue.fix?.description ?? `Programmer fixes: ${issue.title}`,
              }
            : {
                issue,
                strategy: 'manual',
                description: 'Needs a generative AI provider (or a manual fix).',
              };
        }
        return {
          issue,
          strategy: generative ? 'ai' : 'manual',
          description: issue.fix?.description ?? issue.message,
        };
      });
    return { items, aiAvailable: generative };
  }

  /** Applies a fix plan into staged changes and re-analyzes to verify. */
  async applyFixPlan(plan: FixPlan, options: SessionRunOptions = {}): Promise<FixResult> {
    const engine = this.requireEngine();
    this.ensureChanges('staged');
    const autoFixed: string[] = [];
    for (const item of plan.items.filter((i) => i.strategy === 'auto')) {
      try {
        if (await engine.quickFix(this.workspace, item.issue)) autoFixed.push(item.issue.id);
      } catch (error) {
        this.app.logger.warn(`Quick fix failed for ${item.issue.id}`, error);
      }
    }
    const aiItems = plan.items.filter((i) => i.strategy === 'ai');
    let aiRun: AgentRunResult | null = null;
    if (aiItems.length) {
      const task = [
        'Fix these issues found by the project analyzer. Fix the root cause with minimal, focused changes. Do not touch unrelated code.',
        ...aiItems.map(
          (i) =>
            `- [${i.issue.severity}] ${i.issue.title}${i.issue.file ? ` (${i.issue.file}${i.issue.line ? `:${i.issue.line}` : ''})` : ''}: ${i.issue.message}`,
        ),
        'When done, list each issue and what you changed.',
      ].join('\n');
      aiRun = await this.runAgent('programmer', task, { ...options, mode: 'staged' });
    }
    // Verify on the staged content (the analyzer reads through the workspace overlay).
    const after = await engine.analyze(this.workspace, {
      logger: this.app.logger.child('analyze'),
    });
    const remainingIds = new Set(after.issues.map((i) => i.id));
    const planned = plan.items.map((i) => i.issue.id);
    return {
      autoFixed,
      aiRun,
      resolved: planned.filter((id) => !remainingIds.has(id)),
      remaining: after.issues.filter((i) => planned.includes(i.id)),
      changes: this.pendingChanges(),
    };
  }

  // ------------------------------------------------------------ engine actions

  async validate(
    options: SessionRunOptions & { asAgent?: boolean } = {},
  ): Promise<ValidationResult> {
    const engine = this.requireEngine();
    return engine.validate(this.root, {
      logger: this.app.logger.child('validate'),
      ...(options.asAgent ? { permissions: this.permissions } : {}),
      ...(options.signal ? { signal: options.signal } : {}),
      onOutput: (stream, text) =>
        options.onEvent?.({ type: 'output', source: 'validate', stream, text }),
    });
  }

  /** QA step of the pipeline: validate, let the Programmer fix errors, validate again. */
  async validateWithFixes(
    options: SessionRunOptions & { allowAiFixes: boolean; maxRounds?: number },
  ): Promise<ValidationOutcome> {
    const emit = options.onEvent ?? (() => {});
    const step = (status: 'running' | 'done' | 'skipped' | 'failed', detail?: string) =>
      emit({
        type: 'pipeline:step',
        step: 'validate',
        label: 'Validate project with the engine',
        agent: 'QA',
        status,
        ...(detail ? { detail } : {}),
      } satisfies GameForgeEvent);
    step('running');
    let result: ValidationResult;
    try {
      result = await this.validate({ ...options, asAgent: true });
    } catch (error) {
      const userError = toUserError(error);
      step(
        userError.code === 'PERMISSION_DENIED' ? 'skipped' : 'failed',
        userError.reason ?? userError.message,
      );
      return { ok: false, engineAvailable: false, errors: [], output: '', fixRounds: 0 };
    }
    if (!result.engineAvailable) {
      step('skipped', 'Godot not detected — static checks only');
      return { ...result, fixRounds: 0 };
    }
    let rounds = 0;
    while (!result.ok && options.allowAiFixes && rounds < (options.maxRounds ?? 2)) {
      rounds++;
      step('running', `${result.errors.length} error(s) — Programmer fixing (round ${rounds})`);
      const task = [
        'The engine reported these errors when loading the project. Fix them:',
        ...result.errors
          .slice(0, 30)
          .map((e) => `- ${e.file ?? ''}${e.line ? `:${e.line}` : ''} ${e.message}`),
      ].join('\n');
      await this.runAgent('programmer', task, { ...options, mode: 'direct' });
      result = await this.validate({ ...options, asAgent: true });
    }
    step(
      result.ok ? 'done' : 'failed',
      result.ok ? 'No script or scene errors' : `${result.errors.length} error(s) remain`,
    );
    return { ...result, fixRounds: rounds };
  }

  async runTests(options: SessionRunOptions & { asAgent?: boolean } = {}): Promise<TestRunReport> {
    const engine = this.requireEngine();
    return engine.runTests(this.root, {
      logger: this.app.logger.child('tests'),
      ...(options.asAgent ? { permissions: this.permissions } : {}),
      ...(options.signal ? { signal: options.signal } : {}),
      onOutput: (stream, text) =>
        options.onEvent?.({ type: 'output', source: 'tests', stream, text }),
    });
  }

  /** Starts the game (user action). Output is streamed as `output` events. */
  async runGame(
    mode: 'play' | 'debug' = 'play',
    options: SessionRunOptions = {},
  ): Promise<RunningGame> {
    const engine = this.requireEngine();
    this.stopGame();
    const game = await engine.runGame(this.root, {
      mode,
      logger: this.app.logger.child('game'),
      onOutput: (stream, text) =>
        options.onEvent?.({ type: 'output', source: 'game', stream, text }),
    });
    this.runningGame = game;
    game.onExit((code) => {
      if (this.runningGame === game) this.runningGame = null;
      const stoppedByUser = this.stoppedGames.has(game);
      options.onEvent?.({
        type: 'notice',
        level: stoppedByUser || code === 0 || code === null ? 'info' : 'warn',
        message: stoppedByUser ? 'Game stopped.' : `Game exited (code ${code ?? 'killed'}).`,
      });
    });
    return game;
  }

  /** Games stopped on purpose (their non-zero exit code is not an error). */
  private readonly stoppedGames = new WeakSet<RunningGame>();

  stopGame(): void {
    if (this.runningGame) {
      this.stoppedGames.add(this.runningGame);
      this.runningGame.stop();
    }
    this.runningGame = null;
  }
}
