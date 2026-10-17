import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { GameForge, slugify } from '../src/app.js';
import {
  defaultSettings,
  readDotEnv,
  resolveAIConfig,
  SettingsStore,
} from '../src/config/settings.js';
import { runDoctor } from '../src/doctor.js';
import type { AnalysisReport, EngineAdapter, ProjectIssue } from '../src/engines/types.js';
import type { GameForgeEvent } from '../src/events-types.js';
import { GitService, parsePorcelain } from '../src/git/git.js';
import { LogHub } from '../src/logger.js';
import {
  extractJson,
  normalizePlan,
  parseGamePlan,
  renderPlanText,
} from '../src/plan/game-plan.js';
import { offlinePlan } from '../src/plan/offline-planner.js';
import { definePlugin, PluginHost } from '../src/plugins/plugins.js';
import { detectIntent } from '../src/project.js';
import { MockProvider } from '../src/providers/mock.js';
import { tempDir, writeFiles } from './helpers.js';

/** Minimal engine used to test the engine-agnostic pipeline. */
function fakeEngine(): EngineAdapter {
  const issue: ProjectIssue = {
    id: 'missing-input:scripts/p.gd:2',
    ruleId: 'missing-input',
    severity: 'critical',
    category: 'bug',
    title: 'Undefined input action',
    message: 'jump is not defined',
    file: 'scripts/p.gd',
    line: 2,
    fix: { kind: 'auto', description: 'Add the action to project.godot' },
  };
  return {
    id: 'godot',
    displayName: 'FakeEngine',
    agentGuide: 'Fake engine guide.',
    isProject: async (root) => existsSync(path.join(root, 'fake.project')),
    detectInstallation: async () => null,
    generate: async (plan, ws, options) => {
      options?.onPhase?.('scaffold', 'running', []);
      await ws.writeText('fake.project', plan.title);
      await ws.writeText('scripts/p.gd', 'extends Node\nInput.is_action_pressed("jump")\n');
      options?.onPhase?.('scaffold', 'done', ['fake.project', 'scripts/p.gd']);
      return {
        files: ['fake.project', 'scripts/p.gd'],
        customFeatures: plan.features.filter((f) => f.id === 'multiplayer').map((f) => f.id),
        mainScene: 'main',
      };
    },
    analyze: async (ws): Promise<AnalysisReport> => {
      const content = await ws.readText('scripts/p.gd');
      return {
        engine: 'fake',
        projectName: 'fake',
        scores: { architecture: 80, codeQuality: 70, testing: 0, documentation: 10 },
        stats: { files: 2, scripts: 1, scenes: 0, assets: 0, linesOfCode: 2, tests: 0 },
        structure: { autoloads: [], scenes: [], scripts: ['scripts/p.gd'] },
        issues: content.includes('jump') ? [issue] : [],
        engineValidated: false,
        generatedAt: new Date().toISOString(),
      };
    },
    quickFix: async (ws, i) => {
      if (i.ruleId !== 'missing-input') return false;
      const content = await ws.readText('scripts/p.gd');
      await ws.writeText('scripts/p.gd', content.replace('"jump"', '"ui_accept"'), 'QuickFix');
      return true;
    },
    validate: async () => ({ ok: true, engineAvailable: false, errors: [], output: '' }),
    runTests: async () => ({
      runner: 'fake',
      ok: true,
      total: 0,
      passed: 0,
      failed: 0,
      skipped: 0,
      results: [],
      output: '',
      durationMs: 0,
    }),
    runGame: async () => {
      throw new Error('not supported');
    },
  };
}

async function makeApp(env: NodeJS.ProcessEnv = { AI_PROVIDER: 'mock' }) {
  return GameForge.create({
    configDir: tempDir('gf-config-'),
    env,
    logToFile: false,
    builtinPlugins: [
      definePlugin({
        id: 'fake',
        name: 'Fake',
        version: '1.0.0',
        apiVersion: 1,
        activate: (ctx) => ctx.registerEngine(fakeEngine()),
      }),
    ],
  });
}

describe('game plan', () => {
  it('builds a plan like the spec example from a German prompt', () => {
    const plan = offlinePlan(
      'Erstelle ein 3D-Horrorspiel in einem verlassenen Krankenhaus. Der Spieler soll Schlüssel finden, Türen öffnen und von einem Monster verfolgt werden.',
    );
    expect(plan.title).toBe('Abandoned');
    expect(plan.genre).toBe('Horror');
    expect(plan.engine).toBe('godot');
    expect(plan.level.keys).toBe(3);
    const text = renderPlanText(plan);
    expect(text).toContain('GAME PLAN');
    expect(text).toContain('Keys and doors');
  });

  it('normalizes inconsistent plans', () => {
    const plan = offlinePlan('a 2d dungeon game with keys');
    const weird = {
      ...plan,
      dimension: '2d' as const,
      features: [
        ...plan.features,
        { id: 'flashlight', name: 'Flashlight', description: '', priority: 'must' as const },
      ],
    };
    expect(normalizePlan(weird).features.some((f) => f.id === 'flashlight')).toBe(false);
    expect(() => parseGamePlan({ title: '' })).toThrowError(/not valid/);
  });

  it('extracts JSON from fenced and chatty model output', () => {
    expect(extractJson('Sure!\n```json\n{"a": {"b": "}"}}\n```')).toEqual({ a: { b: '}' } });
    expect(extractJson('prefix {"x": 1} suffix')).toEqual({ x: 1 });
    expect(() => extractJson('no json here')).toThrowError();
  });
});

describe('settings', () => {
  it('saves, loads and recovers from corrupt files', () => {
    const store = new SettingsStore(tempDir());
    expect(store.load()).toEqual(defaultSettings());
    store.update((s) => {
      s.ai.provider = 'ollama';
      s.ai.ollama.model = 'qwen';
    });
    expect(store.load().ai.ollama.model).toBe('qwen');
    writeFileSync(store.file, '{ not json');
    expect(store.load()).toEqual(defaultSettings());
  });

  it('resolves AI config with env taking precedence and keys never from settings', () => {
    const settings = defaultSettings();
    settings.ai.provider = 'ollama';
    const config = resolveAIConfig(settings, {
      AI_PROVIDER: 'anthropic',
      ANTHROPIC_API_KEY: 'sk-ant-1',
    });
    expect(config.provider).toBe('anthropic');
    expect(config.anthropic.apiKey).toBe('sk-ant-1');
    expect(config.anthropic.model).toBe('claude-opus-5-5');
    expect(
      resolveAIConfig(settings, {}, { anthropicApiKey: 'from-keychain' }).anthropic.apiKey,
    ).toBe('from-keychain');
    expect(resolveAIConfig(settings, {}).provider).toBe('ollama');
  });

  it('reads .env files without touching process.env', () => {
    const dir = tempDir();
    writeFileSync(path.join(dir, '.env'), 'AI_PROVIDER=mock\n# comment\nOLLAMA_MODEL="llama 3"\n');
    expect(readDotEnv(path.join(dir, '.env'))).toEqual({
      AI_PROVIDER: 'mock',
      OLLAMA_MODEL: 'llama 3',
    });
    expect(process.env.OLLAMA_MODEL).toBeUndefined();
  });
});

describe('GameForge app', () => {
  it('generates a plan with the offline mock and retries invalid AI output', async () => {
    const app = await makeApp();
    const plan = await app.generatePlan(
      'Create a multiplayer horror game inside an abandoned hospital.',
    );
    expect(plan.multiplayer.enabled).toBe(true);
    expect(plan.features.some((f) => f.id === 'multiplayer')).toBe(true);

    const valid = JSON.stringify(offlinePlan('a horror game'));
    const scripted = new MockProvider({ script: [{ text: '{"title": ""}' }, { text: valid }] });
    app.createProvider = () => scripted;
    const events: GameForgeEvent[] = [];
    const retried = await app.generatePlan('a horror game', { onEvent: (e) => events.push(e) });
    expect(retried.genre).toBe('Horror');
    expect(scripted.requests).toHaveLength(2);
    expect(scripted.requests[1]!.messages.at(-1)).toMatchObject({ role: 'user' });
    expect(events.at(-1)).toMatchObject({ type: 'agent:end', status: 'done' });
  });

  it('runs the creation pipeline and reports every step', async () => {
    const app = await makeApp();
    const plan = offlinePlan('Create a multiplayer horror game inside an abandoned hospital.');
    const parent = tempDir();
    const events: GameForgeEvent[] = [];
    const result = await app.createGame(plan, {
      parentDir: parent,
      initGit: false,
      onEvent: (e) => events.push(e),
    });
    expect(result.root).toBe(path.join(parent, 'abandoned'));
    expect(readFileSync(path.join(result.root, 'fake.project'), 'utf8')).toBe('Abandoned');
    const steps = events
      .filter((e) => e.type === 'pipeline:step')
      .map((e) => `${e.step}:${e.status}`);
    expect(steps).toEqual(
      expect.arrayContaining([
        'level:done',
        'scaffold:done',
        'code:skipped',
        'validate:skipped',
        'tests:skipped',
      ]),
    );
    const code = events.find((e) => e.type === 'pipeline:step' && e.step === 'code');
    expect(code).toMatchObject({
      detail: expect.stringContaining('Needs a generative AI provider'),
    });
    await expect(app.createGame(plan, { parentDir: parent, initGit: false })).rejects.toMatchObject(
      { code: 'FILE_EXISTS' },
    );
  });

  it('analyzes, plans fixes, stages them for review and verifies', async () => {
    const app = await makeApp();
    const root = tempDir();
    writeFiles(root, {
      'fake.project': 'x',
      'scripts/p.gd': 'extends Node\nInput.is_action_pressed("jump")\n',
    });
    const project = await app.openProject(root);
    expect(project.engine?.displayName).toBe('FakeEngine');
    const report = await project.analyze();
    const plan = project.createFixPlan(report, { severities: ['critical'] });
    expect(plan.items).toHaveLength(1);
    expect(plan.items[0]!.strategy).toBe('auto');
    const fixed = await project.applyFixPlan(plan);
    expect(fixed.resolved).toEqual([report.issues[0]!.id]);
    expect(fixed.changes).toHaveLength(1);
    // Not on disk until applied.
    expect(readFileSync(path.join(root, 'scripts/p.gd'), 'utf8')).toContain('"jump"');
    expect(project.diff()).toContain('+Input.is_action_pressed("ui_accept")');
    await project.applyChanges();
    expect(readFileSync(path.join(root, 'scripts/p.gd'), 'utf8')).toContain('"ui_accept"');
  });

  it('handles built-in chat intents without AI and explains the mock limits otherwise', async () => {
    expect(detectIntent('Run all tests.')).toBe('run-tests');
    expect(detectIntent('run the game')).toBe('run-game');
    expect(detectIntent('Fix all critical issues.')).toBe('fix');
    expect(detectIntent('Create a horror game.')).toBe('create-game');
    expect(detectIntent('Make the monster faster.')).toBeNull();
    expect(detectIntent('Explain this error.')).toBeNull();

    const app = await makeApp();
    const root = tempDir();
    writeFiles(root, { 'fake.project': 'x', 'scripts/p.gd': 'extends Node\n' });
    const project = await app.openProject(root);
    const tests = await project.chat('Run all tests.');
    expect(tests).toMatchObject({ kind: 'action', action: 'run-tests' });
    const answer = await project.chat('Make the monster faster.');
    expect(answer.kind).toBe('agent');
    if (answer.kind === 'agent') expect(answer.result.summary).toContain('offline mock provider');
  });

  it('runs doctor checks', async () => {
    const app = await makeApp({});
    const report = await runDoctor(app, { cwd: tempDir() });
    const ai = report.checks.find((c) => c.id === 'ai');
    expect(ai?.status).toBe('fail');
    expect(report.ready).toBe(false);
    expect(report.checks.map((c) => c.id)).toEqual(
      expect.arrayContaining(['node', 'git', 'engine:godot', 'workspace', 'plugins']),
    );
  });

  it('slugifies titles for folder names', () => {
    expect(slugify('Abandoned: Ward 13!')).toBe('abandoned-ward-13');
    expect(slugify('Ünïcödé Gämé')).toBe('unicode-game');
    expect(slugify('!!!')).toBe('my-game');
  });
});

describe('plugins', () => {
  it('rejects invalid plugins and incompatible API versions without crashing', async () => {
    const app = await makeApp();
    const bad = await app.plugins.load({
      id: 'old',
      name: 'Old',
      version: '1',
      apiVersion: 99,
      activate: () => {},
    });
    expect(bad.status).toBe('failed');
    expect(bad.error).toContain('plugin API 99');
    const broken = await app.plugins.load({
      id: 'boom',
      name: 'Boom',
      version: '1',
      apiVersion: 1,
      activate: () => {
        throw new Error('kaput');
      },
    });
    expect(broken.status).toBe('failed');
  });

  it('discovers third-party plugins but only loads enabled ones', async () => {
    const dir = tempDir();
    mkdirSync(path.join(dir, 'hello'));
    writeFileSync(
      path.join(dir, 'hello', 'package.json'),
      JSON.stringify({
        name: 'hello',
        version: '1.2.3',
        type: 'module',
        gameforge: { id: 'hello', entry: 'index.js' },
      }),
    );
    writeFileSync(
      path.join(dir, 'hello', 'index.js'),
      `export default { id: 'hello', name: 'Hello', version: '1.2.3', apiVersion: 1, activate(ctx) {
        ctx.registerTool({ name: 'hello_world', description: 'Says hi', access: 'read', input: { safeParse: (v) => ({ success: true, data: v }) }, run: async () => ({ output: 'hi' }) });
      } };`,
    );
    const discovered = PluginHost.discover(dir);
    expect(discovered.map((d) => d.id)).toEqual(['hello']);
    const app = await makeApp();
    expect(await app.plugins.loadDiscovered(discovered, [])).toEqual([]);
    const [info] = await app.plugins.loadDiscovered(discovered, ['hello']);
    expect(info).toMatchObject({
      id: 'hello',
      status: 'active',
      contributes: { tools: ['hello_world'] },
    });
    expect(app.tools.has('hello_world')).toBe(true);
  });
});

describe('git', () => {
  it('parses porcelain status', () => {
    const parsed = parsePorcelain(
      '## main...origin/main [ahead 2]\0 M scripts/player.gd\0?? new.gd\0A  added.gd\0R  b.gd\0a.gd\0',
    );
    expect(parsed.branch).toBe('main');
    expect(parsed.upstream).toBe('origin/main');
    expect(parsed.ahead).toBe(2);
    expect(parsed.files.map((f) => `${f.kind}:${f.path}`)).toEqual([
      'modified:scripts/player.gd',
      'untracked:new.gd',
      'added:added.gd',
      'renamed:b.gd',
    ]);
  });

  it('initializes, reports status, commits and shows history', async () => {
    const git = new GitService();
    if (!git.isAvailable()) return;
    const root = tempDir();
    await git.init(root);
    execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: root });
    execFileSync('git', ['config', 'user.name', 'GameForge Test'], { cwd: root });
    writeFileSync(path.join(root, 'a.gd'), 'extends Node\n');
    let status = await git.status(root);
    expect(status.isRepo).toBe(true);
    expect(status.files[0]).toMatchObject({ path: 'a.gd', untracked: true });
    expect(await git.diff(root, { path: 'a.gd' })).toContain('+extends Node');
    const hash = await git.commit(root, 'Initial commit');
    expect(hash).toMatch(/^[0-9a-f]{7,}$/);
    status = await git.status(root);
    expect(status.files).toEqual([]);
    expect((await git.log(root))[0]).toMatchObject({
      subject: 'Initial commit',
      author: 'GameForge Test',
    });
    await git.createBranch(root, 'feature/ai-changes');
    expect((await git.branches(root)).current).toBe('feature/ai-changes');
    await expect(git.createBranch(root, '--evil')).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    await expect(git.commit(root, 'nothing')).rejects.toMatchObject({
      message: 'Nothing to commit.',
    });
  });
});

describe('logging', () => {
  it('redacts secrets in log entries', () => {
    const hub = new LogHub('debug');
    hub.logger('test').info('key is sk-ant-api03-abcdefghijklmnopqrstuvwxyz');
    expect(hub.recent()[0]!.message).toBe('key is [REDACTED]');
  });
});

describe('example plugin', () => {
  it('loads examples/plugins/hello-tools and runs its tool in the sandbox', async () => {
    const examples = path.resolve(import.meta.dirname, '../../../examples/plugins');
    const discovered = PluginHost.discover(examples);
    expect(discovered.map((d) => d.id)).toContain('hello-tools');
    const app = await makeApp();
    const [info] = await app.plugins.loadDiscovered(discovered, ['hello-tools']);
    expect(info).toMatchObject({ status: 'active', contributes: { tools: ['script_summary'] } });
    const root = tempDir();
    writeFiles(root, {
      'fake.project': 'x',
      'a.gd': 'extends Node\n\nfunc a():\n\tpass\n',
      'b.gd': 'extends Node\n',
    });
    const project = await app.openProject(root);
    const result = await app.tools.execute(
      'script_summary',
      {},
      { ...project.toolContext(), actor: 'Test' },
    );
    expect(result.ok).toBe(true);
    expect(result.output).toContain('2 scripts');
    expect(app.tools.specs(['script_summary'])[0]!.inputSchema).toEqual({ type: 'object' });
  });
});
