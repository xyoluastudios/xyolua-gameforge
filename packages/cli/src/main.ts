import { existsSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import {
  formatUserError,
  GameForge,
  GameForgeError,
  parseGamePlan,
  readDotEnv,
  renderPlanText,
  runDoctor,
  toUserError,
  type ConfirmationDecision,
  type GameForgeEvent,
  type GamePlan,
  type IssueSeverity,
  type ProjectSession,
  type Settings,
} from '@gameforge/core';
import { createGodotPlugin } from '@gameforge/godot';
import { McpServer } from '@gameforge/mcp';
import { readFileSync } from 'node:fs';
import { processIO, style, type CliIO } from './io.js';

export const VERSION = '0.1.0';

const HELP = `XyoLua GameForge ${VERSION} — AI game development environment

Usage:
  gameforge create "<description>" [--dir <folder>] [--name <name>] [--plan <plan.json>] [--yes] [--no-git]
  gameforge analyze [project] [--json]
  gameforge fix [project] [--critical] [--issue <id>]... [--yes] [--diff]
  gameforge chat "<request>" [--project <path>] [--yes]
  gameforge test [project]
  gameforge run [project] [--debug]
  gameforge doctor [--online]
  gameforge config list | get <key> | set <key> <value> | path
  gameforge mcp --project <path> [--dir <folder for new games>] [--allow-write]

Options:
  --yes, -y      Approve plans, fixes and confirmations without asking
  --help, -h     Show this help
  --version, -v  Show the version

Configuration is read from environment variables and a .env file in the
current folder (see .env.example). Use AI_PROVIDER=mock to try it offline.`;

const ICON: Record<IssueSeverity, string> = {
  critical: '🔴',
  high: '🟠',
  medium: '🟡',
  low: '⚪',
  info: '·',
};

interface Context {
  io: CliIO;
  s: ReturnType<typeof style>;
  yes: boolean;
}

/** Creates the app with .env support, the Godot plugin and a terminal confirmation handler. */
export async function createCliApp(
  ctx: Context,
  options: { configDir?: string; env?: NodeJS.ProcessEnv } = {},
): Promise<GameForge> {
  const env = { ...readDotEnv(path.join(process.cwd(), '.env')), ...(options.env ?? process.env) };
  let appRef: GameForge | null = null;
  const app = await GameForge.create({
    env,
    ...(options.configDir ? { configDir: options.configDir } : {}),
    builtinPlugins: [
      createGodotPlugin({ configuredExecutable: () => appRef?.settings.godot.executable, env }),
    ],
    confirm: async (request): Promise<ConfirmationDecision> => {
      ctx.io.err('');
      ctx.io.err(ctx.s.yellow(`⚠️  ${request.title}`));
      ctx.io.err('');
      ctx.io.err(request.message);
      if (ctx.yes) {
        ctx.io.err(ctx.s.dim('→ allowed once (--yes)'));
        return 'once';
      }
      const answer = await ctx.io.ask('\n[o] Allow once   [p] Allow for project   [c] Cancel  › ');
      if (answer === null) {
        ctx.io.err(ctx.s.dim('→ cancelled (no interactive terminal; use --yes to allow)'));
        return 'deny';
      }
      return /^p/i.test(answer) ? 'project' : /^o|^a|^y/i.test(answer) ? 'once' : 'deny';
    },
  });
  appRef = app;
  return app;
}

function printEvent(ctx: Context, event: GameForgeEvent): void {
  const { io, s } = ctx;
  switch (event.type) {
    case 'pipeline:step': {
      const mark =
        event.status === 'running'
          ? s.blue('…')
          : event.status === 'done'
            ? s.green('✓')
            : event.status === 'skipped'
              ? s.dim('–')
              : s.red('✗');
      if (event.status === 'running' && event.detail === undefined)
        io.out(`${mark} ${s.bold(event.agent)} ${event.label}`);
      else
        io.out(
          `${mark} ${s.bold(event.agent)} ${event.label}${event.detail ? s.dim(` — ${event.detail}`) : ''}`,
        );
      break;
    }
    case 'agent:start':
      io.out(
        s.cyan(`▶ ${event.agentName}`) + s.dim(` ${event.task.split('\n')[0]!.slice(0, 100)}`),
      );
      break;
    case 'tool:end':
      io.out(
        s.dim(
          `  ${event.result.ok ? '•' : '✗'} ${event.tool}${event.result.ok ? '' : `: ${event.result.output.split('\n')[0]!.slice(0, 120)}`}`,
        ),
      );
      break;
    case 'agent:end':
      if (event.status !== 'done')
        io.out(
          s.yellow(`  ${event.agent} stopped: ${event.status} — ${event.summary.slice(0, 200)}`),
        );
      break;
    case 'notice':
      io.out(
        event.level === 'error'
          ? s.red(event.message)
          : event.level === 'warn'
            ? s.yellow(event.message)
            : s.dim(event.message),
      );
      break;
    default:
      break;
  }
}

async function openProject(app: GameForge, target: string | undefined): Promise<ProjectSession> {
  const root = path.resolve(target ?? process.cwd());
  if (!existsSync(root)) throw new GameForgeError('PROJECT_NOT_FOUND', `Folder not found: ${root}`);
  const project = await app.openProject(root);
  if (!project.engine) {
    throw new GameForgeError('PROJECT_INVALID', 'Not a Godot project.', {
      reason: `${root} has no project.godot.`,
      solution: 'Run the command inside a Godot project or pass its path.',
    });
  }
  return project;
}

async function cmdCreate(
  ctx: Context,
  app: GameForge,
  args: string[],
  flags: Record<string, unknown>,
): Promise<number> {
  const { io, s } = ctx;
  let plan: GamePlan;
  const description = args.join(' ').trim();
  if (typeof flags.plan === 'string') {
    plan = parseGamePlan(JSON.parse(readFileSync(flags.plan, 'utf8')) as unknown);
  } else {
    if (!description)
      throw new GameForgeError('INVALID_INPUT', 'Describe your game.', {
        solution: 'gameforge create "A horror game inside an abandoned hospital"',
      });
    io.out(s.dim(`Planning with ${app.createProvider().displayName}…`));
    plan = await app.generatePlan(description);
  }
  for (;;) {
    io.out('');
    io.out(renderPlanText(plan));
    io.out('');
    if (ctx.yes) break;
    const answer = await ctx.io.ask('[a] Approve   [e] Edit   [r] Regenerate   [c] Cancel  › ');
    if (answer === null)
      throw new GameForgeError('CANCELLED', 'No interactive terminal to approve the plan.', {
        solution: 'Re-run with --yes to approve automatically.',
      });
    if (/^a|^y/i.test(answer)) break;
    if (/^c|^n/i.test(answer)) {
      io.out('Cancelled. Nothing was created.');
      return 1;
    }
    if (/^e/i.test(answer)) {
      const feedback = await ctx.io.ask('What should change? › ');
      if (feedback)
        plan = await app.generatePlan(description || plan.summary, { previous: plan, feedback });
    } else if (/^r/i.test(answer)) {
      plan = await app.generatePlan(description || plan.summary);
    }
  }
  const parentDir = path.resolve(typeof flags.dir === 'string' ? flags.dir : process.cwd());
  io.out(s.bold(`Creating "${plan.title}" in ${parentDir}`));
  const result = await app.createGame(plan, {
    parentDir,
    ...(typeof flags.name === 'string' ? { folderName: flags.name } : {}),
    initGit: flags['no-git'] !== true,
    onEvent: (event) => printEvent(ctx, event),
  });
  io.out('');
  io.out(s.green(`✓ Created ${result.files.length} files in ${result.root}`));
  const changes = result.project.pendingChanges();
  if (changes.length)
    io.out(
      s.yellow(
        `AI created changes in ${changes.length} file(s) after the initial commit — review them with git diff.`,
      ),
    );
  if (result.tests) io.out(`Tests: ${result.tests.passed}/${result.tests.total} passed`);
  io.out(`\nNext:\n  gameforge run "${result.root}"\n  gameforge analyze "${result.root}"`);
  return 0;
}

async function cmdAnalyze(
  ctx: Context,
  app: GameForge,
  target: string | undefined,
  json: boolean,
): Promise<number> {
  const { io, s } = ctx;
  const project = await openProject(app, target);
  const report = await project.analyze();
  if (json) {
    io.out(JSON.stringify(report, null, 2));
    return 0;
  }
  io.out(s.bold(`Project Analysis — ${report.projectName}`));
  io.out('');
  const bar = (score: number) =>
    `${score.toString().padStart(3)}/100 ${s.dim('█'.repeat(Math.round(score / 10)).padEnd(10, '░'))}`;
  io.out(`Architecture:   ${bar(report.scores.architecture)}`);
  io.out(`Code Quality:   ${bar(report.scores.codeQuality)}`);
  io.out(`Testing:        ${bar(report.scores.testing)}`);
  io.out(`Documentation:  ${bar(report.scores.documentation)}`);
  io.out('');
  io.out(
    `${report.stats.scripts} scripts · ${report.stats.scenes} scenes · ${report.stats.assets} assets · ${report.stats.linesOfCode} lines of code · ${report.stats.tests} test files`,
  );
  io.out('');
  io.out(s.bold(`Issues found: ${report.issues.length}`));
  for (const issue of report.issues) {
    const where = issue.file ? s.dim(` ${issue.file}${issue.line ? `:${issue.line}` : ''}`) : '';
    io.out(`${ICON[issue.severity]} ${issue.title}${where}`);
    io.out(
      s.dim(
        `   ${issue.message}${issue.fix ? ` [${issue.fix.kind === 'auto' ? 'quick fix' : 'AI fix'}]` : ''}`,
      ),
    );
  }
  const critical = report.issues.filter((i) => i.severity === 'critical').length;
  if (critical)
    io.out(`\n${s.bold(`Run "gameforge fix --critical" to fix ${critical} critical issue(s).`)}`);
  return 0;
}

async function cmdFix(
  ctx: Context,
  app: GameForge,
  target: string | undefined,
  flags: Record<string, unknown>,
): Promise<number> {
  const { io, s } = ctx;
  const project = await openProject(app, target);
  io.out(s.dim('Analyzing…'));
  const report = await project.analyze();
  const ids = Array.isArray(flags.issue) ? (flags.issue as string[]) : undefined;
  const plan = project.createFixPlan(
    report,
    ids
      ? { issueIds: ids }
      : flags.critical
        ? { severities: ['critical'] }
        : { severities: ['critical', 'high', 'medium'] },
  );
  if (plan.items.length === 0) {
    io.out(s.green('Nothing to fix.'));
    return 0;
  }
  io.out(s.bold('Fix plan'));
  for (const item of plan.items) {
    const how =
      item.strategy === 'auto'
        ? s.green('quick fix')
        : item.strategy === 'ai'
          ? s.cyan('AI')
          : s.dim('manual');
    io.out(
      `${ICON[item.issue.severity]} ${item.issue.title}${item.issue.file ? s.dim(` ${item.issue.file}${item.issue.line ? `:${item.issue.line}` : ''}`) : ''} → ${how}`,
    );
  }
  const actionable = plan.items.filter((i) => i.strategy !== 'manual');
  if (actionable.length === 0) {
    io.out(s.yellow('\nNo automatic fixes available. Configure an AI provider for AI fixes.'));
    return 1;
  }
  if (!ctx.yes) {
    const answer = await io.ask(
      `\nApply ${actionable.length} fix(es)? Changes are staged for review first. [y/N] › `,
    );
    if (!answer || !/^y/i.test(answer)) {
      io.out('Cancelled.');
      return 1;
    }
  }
  const result = await project.applyFixPlan(plan, { onEvent: (event) => printEvent(ctx, event) });
  io.out('');
  io.out(
    s.bold(
      `Resolved ${result.resolved.length}/${plan.items.length} issue(s); ${result.changes.length} file(s) changed:`,
    ),
  );
  for (const change of result.changes)
    io.out(
      `  ${change.kind.padEnd(6)} ${change.path} ${s.green(`+${change.additions}`)} ${s.red(`-${change.deletions}`)}`,
    );
  if (flags.diff) io.out(`\n${project.diff()}`);
  if (result.changes.length === 0) return result.resolved.length ? 0 : 1;
  if (!ctx.yes) {
    const answer = await io.ask('\nApply these changes to disk? [y/N] (d = show diff) › ');
    if (answer && /^d/i.test(answer)) {
      io.out(project.diff());
      const again = await io.ask('Apply? [y/N] › ');
      if (!again || !/^y/i.test(again)) {
        await project.discardChanges();
        io.out('Discarded. Nothing was changed.');
        return 1;
      }
    } else if (!answer || !/^y/i.test(answer)) {
      await project.discardChanges();
      io.out('Discarded. Nothing was changed.');
      return 1;
    }
  }
  await project.applyChanges();
  io.out(s.green('✓ Changes applied.'));
  if (await project.engine?.detectInstallation()) {
    io.out(s.dim('Running tests…'));
    const tests = await project.runTests();
    if (tests.error)
      io.out(
        s.yellow(
          `Tests not run: ${tests.error.message}${tests.error.solution ? ` ${tests.error.solution}` : ''}`,
        ),
      );
    else
      io.out(
        tests.ok
          ? s.green(`✓ Tests: ${tests.passed}/${tests.total} passed`)
          : s.red(`✗ Tests: ${tests.failed} of ${tests.total} failed`),
      );
  }
  return 0;
}

async function cmdTest(ctx: Context, app: GameForge, target: string | undefined): Promise<number> {
  const { io, s } = ctx;
  const project = await openProject(app, target);
  const report = await project.runTests();
  for (const result of report.results) {
    const mark =
      result.status === 'passed'
        ? s.green('✓')
        : result.status === 'failed'
          ? s.red('✗')
          : s.dim('–');
    io.out(`${mark} ${result.name}${result.message ? s.dim(` — ${result.message}`) : ''}`);
  }
  if (report.error) io.err(formatUserError(report.error));
  io.out(
    `\n${report.ok ? s.green('PASSED') : s.red('FAILED')} ${report.passed} passed, ${report.failed} failed, ${report.skipped} skipped (${(report.durationMs / 1000).toFixed(1)}s)`,
  );
  return report.ok ? 0 : 1;
}

async function cmdRun(
  ctx: Context,
  app: GameForge,
  target: string | undefined,
  debug: boolean,
): Promise<number> {
  const project = await openProject(app, target);
  const game = await project.runGame(debug ? 'debug' : 'play', {
    onEvent: (event) => {
      if (event.type === 'output')
        (event.stream === 'stderr' ? ctx.io.err : ctx.io.out)(event.text.replace(/\n$/, ''));
    },
  });
  ctx.io.out(ctx.s.dim(`Game started (pid ${game.pid}). Press Ctrl+C to stop.`));
  const stop = () => game.stop();
  process.once('SIGINT', stop);
  const code = await new Promise<number | null>((resolve) => game.onExit(resolve));
  process.removeListener('SIGINT', stop);
  return code ?? 0;
}

async function cmdDoctor(ctx: Context, app: GameForge, online: boolean): Promise<number> {
  const { io, s } = ctx;
  io.out(s.bold('XyoLua GameForge Doctor'));
  io.out('');
  const report = await runDoctor(app, { online });
  for (const check of report.checks) {
    const mark =
      check.status === 'ok'
        ? s.green('✓')
        : check.status === 'warn'
          ? s.yellow('!')
          : check.status === 'fail'
            ? s.red('✗')
            : s.dim('–');
    io.out(`${mark} ${check.label.padEnd(14)} ${s.dim(check.detail)}`);
    if (check.solution && check.status !== 'ok') io.out(`  ${s.dim('→')} ${check.solution}`);
  }
  io.out('');
  io.out(report.ready ? s.green('Everything is ready.') : s.yellow('Some checks need attention.'));
  return report.ready ? 0 : 1;
}

const CONFIG_KEYS: Record<string, (s: Settings, value: string) => void> = {
  'ai.provider': (s, v) => (s.ai.provider = v || null),
  'ai.anthropic.model': (s, v) => (s.ai.anthropic.model = v),
  'ai.anthropic.effort': (s, v) =>
    (s.ai.anthropic.effort = v as Settings['ai']['anthropic']['effort']),
  'ai.anthropic.fallbacks': (s, v) => (s.ai.anthropic.fallbacks = v === 'true'),
  'ai.openai.baseUrl': (s, v) => (s.ai.openai.baseUrl = v),
  'ai.openai.model': (s, v) => (s.ai.openai.model = v),
  'ai.ollama.baseUrl': (s, v) => (s.ai.ollama.baseUrl = v),
  'ai.ollama.model': (s, v) => (s.ai.ollama.model = v),
  'godot.executable': (s, v) => (s.godot.executable = v || undefined),
  'mcp.enabled': (s, v) => (s.mcp.enabled = v === 'true'),
  'mcp.allowWrite': (s, v) => (s.mcp.allowWrite = v === 'true'),
  'agents.changeMode': (s, v) => (s.agents.changeMode = v as 'staged' | 'direct'),
  'agents.maxSteps': (s, v) => (s.agents.maxSteps = Number(v)),
  'plugins.enabled': (s, v) =>
    (s.plugins.enabled = v
      .split(',')
      .map((x) => x.trim())
      .filter(Boolean)),
};

function getPath(object: unknown, key: string): unknown {
  return key
    .split('.')
    .reduce<unknown>(
      (value, part) =>
        value && typeof value === 'object' ? (value as Record<string, unknown>)[part] : undefined,
      object,
    );
}

function cmdConfig(ctx: Context, app: GameForge, args: string[]): number {
  const [action, key, ...rest] = args;
  if (action === 'path') {
    ctx.io.out(app.settingsStore.file);
    return 0;
  }
  if (!action || action === 'list') {
    ctx.io.out(JSON.stringify(app.settings, null, 2));
    return 0;
  }
  if (action === 'get' && key) {
    ctx.io.out(JSON.stringify(getPath(app.settings, key) ?? null));
    return 0;
  }
  if (action === 'set' && key) {
    const setter = CONFIG_KEYS[key];
    if (!setter)
      throw new GameForgeError('INVALID_INPUT', `Unknown setting "${key}".`, {
        solution: `Settable keys: ${Object.keys(CONFIG_KEYS).join(', ')}. API keys belong in environment variables or .env.`,
      });
    app.settingsStore.update((s) => setter(s, rest.join(' ')));
    ctx.io.out(`${key} = ${JSON.stringify(getPath(app.settings, key))}`);
    return 0;
  }
  throw new GameForgeError(
    'INVALID_INPUT',
    'Usage: gameforge config list | get <key> | set <key> <value> | path',
  );
}

async function cmdChat(
  ctx: Context,
  app: GameForge,
  message: string,
  target: string | undefined,
): Promise<number> {
  const { io, s } = ctx;
  if (!message)
    throw new GameForgeError('INVALID_INPUT', 'What should GameForge do?', {
      solution: 'gameforge chat "Make the monster faster"',
    });
  const project = await openProject(app, target);
  const outcome = await project.chat(message, {
    onEvent: (event) => printEvent(ctx, event),
    mode: 'staged',
  });
  if (outcome.kind === 'action') {
    io.out(s.dim(`Handled as built-in action: ${outcome.action}`));
    if (outcome.action === 'git-status') io.out(outcome.text);
    if (outcome.action === 'run-tests')
      io.out(`${outcome.report.passed}/${outcome.report.total} passed`);
    if (outcome.action === 'analyze') io.out(`${outcome.report.issues.length} issues`);
    if (outcome.action === 'fix-plan')
      io.out(`${outcome.plan.items.length} fixes planned — run "gameforge fix"`);
    return 0;
  }
  io.out(`\n${outcome.result.summary}`);
  if (outcome.changes.length) {
    io.out(s.bold(`\nAI created changes. ${outcome.changes.length} file(s) changed.`));
    for (const c of outcome.changes)
      io.out(
        `  ${c.kind.padEnd(6)} ${c.path} ${s.green(`+${c.additions}`)} ${s.red(`-${c.deletions}`)}`,
      );
    const answer = ctx.yes ? 'y' : await io.ask('Apply? [y]es / [d]iff / [N]o › ');
    if (answer && /^d/i.test(answer)) io.out(project.diff());
    const apply =
      ctx.yes ||
      (answer && /^y/i.test(answer)) ||
      (answer && /^d/i.test(answer) && /^y/i.test((await io.ask('Apply? [y/N] › ')) ?? ''));
    if (apply) {
      await project.applyChanges();
      io.out(s.green('✓ Applied. Review with git diff, commit when you are happy.'));
    } else {
      await project.discardChanges();
      io.out('Discarded.');
    }
  }
  return outcome.result.status === 'done' ? 0 : 1;
}

async function cmdMcp(
  ctx: Context,
  app: GameForge,
  flags: Record<string, unknown>,
): Promise<number> {
  const settings = app.settings;
  if (!settings.mcp.enabled) {
    throw new GameForgeError('PERMISSION_DENIED', 'The MCP server is disabled.', {
      solution:
        'Enable it with: gameforge config set mcp.enabled true  (or Settings → MCP in the desktop app).',
    });
  }
  // stdout belongs to the protocol — all logs go to stderr.
  app.logHub.addSink((entry) => process.stderr.write(`[${entry.level}] ${entry.message}\n`));
  const server = new McpServer({
    app,
    ...(typeof flags.project === 'string' ? { projectRoot: path.resolve(flags.project) } : {}),
    createRoot: path.resolve(typeof flags.dir === 'string' ? flags.dir : process.cwd()),
    allowWrite: flags['allow-write'] === true || settings.mcp.allowWrite,
  });
  await server.serve();
  return 0;
}

/** CLI entry point. Returns the process exit code — never throws. */
export async function main(
  argv: string[],
  io: CliIO = processIO(),
  options: { configDir?: string; env?: NodeJS.ProcessEnv } = {},
): Promise<number> {
  let parsed: ReturnType<typeof parseArgs>;
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      strict: true,
      options: {
        help: { type: 'boolean', short: 'h' },
        version: { type: 'boolean', short: 'v' },
        yes: { type: 'boolean', short: 'y' },
        json: { type: 'boolean' },
        online: { type: 'boolean' },
        debug: { type: 'boolean' },
        critical: { type: 'boolean' },
        diff: { type: 'boolean' },
        'no-git': { type: 'boolean' },
        'allow-write': { type: 'boolean' },
        dir: { type: 'string' },
        name: { type: 'string' },
        plan: { type: 'string' },
        project: { type: 'string' },
        issue: { type: 'string', multiple: true },
      },
    });
  } catch (error) {
    io.err(`${error instanceof Error ? error.message : String(error)}\n\n${HELP}`);
    return 2;
  }
  const { values: flags, positionals } = parsed;
  const [command, ...args] = positionals;
  if (flags.version) {
    io.out(VERSION);
    return 0;
  }
  if (flags.help || !command || command === 'help') {
    io.out(HELP);
    return command || flags.help ? 0 : 1;
  }
  const ctx: Context = { io, s: style(io), yes: flags.yes === true };
  try {
    const app = await createCliApp(ctx, options);
    switch (command) {
      case 'create':
        return await cmdCreate(ctx, app, args, flags);
      case 'analyze':
        return await cmdAnalyze(ctx, app, args[0], flags.json === true);
      case 'fix':
        return await cmdFix(ctx, app, args[0], flags);
      case 'test':
        return await cmdTest(ctx, app, args[0]);
      case 'run':
        return await cmdRun(ctx, app, args[0], flags.debug === true);
      case 'doctor':
        return await cmdDoctor(ctx, app, flags.online === true);
      case 'config':
        return cmdConfig(ctx, app, args);
      case 'chat':
        return await cmdChat(
          ctx,
          app,
          args.join(' '),
          typeof flags.project === 'string' ? flags.project : undefined,
        );
      case 'mcp':
        return await cmdMcp(ctx, app, flags);
      default:
        io.err(`Unknown command "${command}".\n\n${HELP}`);
        return 2;
    }
  } catch (error) {
    const userError = toUserError(error);
    io.err('');
    io.err(ctx.s.red(formatUserError(userError)));
    return userError.code === 'CANCELLED' ? 130 : 1;
  }
}
