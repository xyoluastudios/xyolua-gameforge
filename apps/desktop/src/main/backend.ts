import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, statSync, watch, type FSWatcher } from 'node:fs';
import path from 'node:path';
import {
  GameForge,
  GameForgeError,
  parseCommand,
  runCommand,
  runDoctor,
  type ChatMessage,
  type ConfirmationDecision,
  type ConfirmationRequest,
  type FileChange,
  type FixPlan,
  type GameForgeEvent,
  type GamePlan,
  type ProjectSession,
  type RunningGame,
} from '@gameforge/core';
import { createGodotPlugin } from '@gameforge/godot';
import { Workspace } from '@gameforge/core';
import type {
  AppInfo,
  ChatOutcomeView,
  CreateGameRequest,
  CreateGameView,
  EventMap,
  FileNode,
  FixResultView,
  GameStatus,
  ProjectView,
  SettingsPatch,
  SettingsView,
} from '@shared/api';
import { SecretStore } from './secrets';

export interface BackendOptions {
  configDir?: string;
  templatesDir: string;
  projectsDir: string;
  version: string;
  e2e: boolean;
  send: <E extends keyof EventMap>(channel: E, payload: EventMap[E]) => void;
}

const MAX_HISTORY = 40;

/** Bridges the UI to the GameForge core. One instance per app. */
export class Backend {
  app!: GameForge;
  private secrets!: SecretStore;
  private project: ProjectSession | null = null;
  /** Editor access: user policy, independent of the agents' staged changes. */
  private userWorkspace: Workspace | null = null;
  private history: ChatMessage[] = [];
  private abort: AbortController | null = null;
  private pendingConfirms = new Map<string, (decision: ConfirmationDecision) => void>();
  private game: RunningGame | null = null;
  private gameMode: 'play' | 'debug' | undefined;
  private previewTimer: NodeJS.Timeout | null = null;
  private lastPreviewMtime = 0;
  private watcher: FSWatcher | null = null;
  private changedPaths = new Set<string>();
  private watchTimer: NodeJS.Timeout | null = null;
  private lastApplied: FileChange[] = [];

  constructor(private readonly options: BackendOptions) {}

  async init(): Promise<void> {
    let appRef: GameForge | null = null;
    this.app = await GameForge.create({
      ...(this.options.configDir ? { configDir: this.options.configDir } : {}),
      env: process.env,
      secrets: () => ({
        ...(this.secrets?.get('anthropic')
          ? { anthropicApiKey: this.secrets.get('anthropic')! }
          : {}),
        ...(this.secrets?.get('openai') ? { openaiApiKey: this.secrets.get('openai')! } : {}),
      }),
      confirm: (request) => this.askUser(request),
      builtinPlugins: [
        createGodotPlugin({
          templatesDir: this.options.templatesDir,
          configuredExecutable: () => appRef?.settings.godot.executable,
          previewFile: (root) => path.join(root, '.gameforge', 'preview.png'),
        }),
      ],
    });
    appRef = this.app;
    this.secrets = new SecretStore(this.app.configDir);
    this.app.logHub.addSink((entry) => this.options.send('log', entry));
    this.app.logger.info(`XyoLua GameForge ${this.options.version} started`);
  }

  private emit = (event: GameForgeEvent) => this.options.send('event', event);

  // ------------------------------------------------------------ confirmations

  private askUser(request: ConfirmationRequest): Promise<ConfirmationDecision> {
    return new Promise((resolve) => {
      this.pendingConfirms.set(request.id, resolve);
      this.options.send('confirm', request);
    });
  }

  respondConfirm(id: string, decision: ConfirmationDecision): void {
    const resolve = this.pendingConfirms.get(id);
    this.pendingConfirms.delete(id);
    resolve?.(decision);
  }

  // ------------------------------------------------------------ app & settings

  info(): AppInfo {
    return {
      version: this.options.version,
      platform: process.platform,
      configDir: this.app.configDir,
      pluginDir: this.app.pluginDir,
      defaultProjectsDir: this.options.projectsDir,
      e2e: this.options.e2e,
    };
  }

  settings(): SettingsView {
    const s = this.app.settings;
    const config = this.app.aiConfig();
    const keySource = (envName: string, secret: string): 'env' | 'keychain' | null =>
      process.env[envName] ? 'env' : this.secrets.get(secret) ? 'keychain' : null;
    let activeLabel: string;
    let generative = false;
    try {
      const provider = this.app.createProvider();
      activeLabel = `${provider.displayName} · ${provider.model}`;
      generative = provider.capabilities.generative;
    } catch {
      activeLabel = config.provider ? `${config.provider} (not configured)` : 'No AI provider';
    }
    return {
      provider: config.provider,
      providers: this.app.providers
        .list()
        .map((p) => ({ id: p.id, displayName: p.displayName, description: p.description })),
      anthropic: {
        model: config.anthropic.model,
        effort: config.anthropic.effort,
        fallbacks: config.anthropic.fallbacks,
        ...(s.ai.anthropic.baseUrl ? { baseUrl: s.ai.anthropic.baseUrl } : {}),
        hasKey: !!config.anthropic.apiKey,
        keySource: keySource('ANTHROPIC_API_KEY', 'anthropic'),
      },
      openai: {
        baseUrl: config.openai.baseUrl,
        ...(config.openai.model ? { model: config.openai.model } : {}),
        jsonMode: config.openai.jsonMode,
        hasKey: !!config.openai.apiKey,
        keySource: keySource('OPENAI_API_KEY', 'openai'),
      },
      ollama: {
        baseUrl: config.ollama.baseUrl,
        ...(config.ollama.model ? { model: config.ollama.model } : {}),
      },
      godot: { ...(s.godot.executable ? { executable: s.godot.executable } : {}) },
      agents: s.agents,
      mcp: { ...s.mcp, command: 'gameforge mcp --project "<path to your game>"' },
      secureStorage: this.secrets.available(),
      activeLabel,
      generative,
    };
  }

  saveSettings(patch: SettingsPatch): SettingsView {
    this.app.settingsStore.update((s) => {
      if (patch.provider !== undefined) s.ai.provider = patch.provider;
      if (patch.anthropic) {
        const a = patch.anthropic;
        if (a.model !== undefined) s.ai.anthropic.model = a.model || s.ai.anthropic.model;
        if (a.effort !== undefined)
          s.ai.anthropic.effort = a.effort as typeof s.ai.anthropic.effort;
        if (a.fallbacks !== undefined) s.ai.anthropic.fallbacks = a.fallbacks;
        if (a.baseUrl !== undefined) s.ai.anthropic.baseUrl = a.baseUrl || undefined;
      }
      if (patch.openai) {
        if (patch.openai.baseUrl !== undefined)
          s.ai.openai.baseUrl = patch.openai.baseUrl || s.ai.openai.baseUrl;
        if (patch.openai.model !== undefined) s.ai.openai.model = patch.openai.model || undefined;
        if (patch.openai.jsonMode !== undefined) s.ai.openai.jsonMode = patch.openai.jsonMode;
      }
      if (patch.ollama) {
        if (patch.ollama.baseUrl !== undefined)
          s.ai.ollama.baseUrl = patch.ollama.baseUrl || s.ai.ollama.baseUrl;
        if (patch.ollama.model !== undefined) s.ai.ollama.model = patch.ollama.model || undefined;
      }
      if (patch.godot && patch.godot.executable !== undefined)
        s.godot.executable = patch.godot.executable || undefined;
      if (patch.agents?.changeMode) s.agents.changeMode = patch.agents.changeMode;
      if (patch.agents?.maxSteps) s.agents.maxSteps = patch.agents.maxSteps;
      if (patch.mcp?.enabled !== undefined) s.mcp.enabled = patch.mcp.enabled;
      if (patch.mcp?.allowWrite !== undefined) s.mcp.allowWrite = patch.mcp.allowWrite;
    });
    return this.settings();
  }

  setApiKey(provider: 'anthropic' | 'openai', key: string | null): SettingsView {
    if (key && !this.secrets.available()) {
      throw new GameForgeError(
        'PERMISSION_DENIED',
        'API keys cannot be stored securely on this system.',
        {
          reason: 'No OS keychain is available to encrypt the key.',
          solution: `Set ${provider === 'anthropic' ? 'ANTHROPIC_API_KEY' : 'OPENAI_API_KEY'} as an environment variable instead.`,
        },
      );
    }
    this.secrets.set(provider, key?.trim() || null);
    this.app.logger.info(`${provider} API key ${key ? 'saved (encrypted)' : 'removed'}`);
    return this.settings();
  }

  async testProvider() {
    try {
      return await this.app.createProvider().healthCheck(AbortSignal.timeout(20_000));
    } catch (error) {
      const e = error instanceof GameForgeError ? error : null;
      return {
        ok: false,
        message: [e?.reason ?? e?.message ?? String(error), e?.solution]
          .filter(Boolean)
          .join(' — '),
      };
    }
  }

  async detectEngine() {
    return (await this.app.engine('godot').detectInstallation()) ?? null;
  }

  doctor(online: boolean) {
    return runDoctor(this.app, { online });
  }

  plugins() {
    return this.app.listPlugins();
  }

  setPluginEnabled(id: string, enabled: boolean) {
    this.app.settingsStore.update((s) => {
      s.plugins.enabled = enabled
        ? [...new Set([...s.plugins.enabled, id])]
        : s.plugins.enabled.filter((p) => p !== id);
    });
    this.app.logger.info(
      `Plugin ${id} ${enabled ? 'enabled' : 'disabled'} (takes effect after restart)`,
    );
    return this.plugins();
  }

  // ------------------------------------------------------------ project

  private requireProject(): ProjectSession {
    if (!this.project) {
      throw new GameForgeError('PROJECT_NOT_FOUND', 'No project is open.', {
        solution: 'Create a game or open a project first.',
      });
    }
    return this.project;
  }

  async openProject(root: string): Promise<ProjectView> {
    await this.closeProject();
    const project = await this.app.openProject(root);
    this.project = project;
    this.userWorkspace = Workspace.open(project.root, { policy: 'user' });
    this.history = [];
    this.startWatcher(project.root);
    this.app.logger.info(`Opened ${project.root}`);
    return this.currentProject()!;
  }

  async closeProject(): Promise<void> {
    this.stopGame();
    this.abort?.abort();
    this.watcher?.close();
    this.watcher = null;
    this.project = null;
    this.userWorkspace = null;
    this.history = [];
    this.lastApplied = [];
  }

  currentProject(): ProjectView | null {
    if (!this.project) return null;
    let mainScene: string | undefined;
    try {
      mainScene = /run\/main_scene="([^"]+)"/.exec(
        readFileSync(path.join(this.project.root, 'project.godot'), 'utf8'),
      )?.[1];
    } catch {
      mainScene = undefined;
    }
    return {
      root: this.project.root,
      name: this.project.name,
      engine: this.project.engine?.displayName ?? null,
      isGit: this.app.git.hasGitDir(this.project.root),
      ...(mainScene ? { mainScene } : {}),
    };
  }

  recentProjects(): string[] {
    return this.app.settings.recentProjects.filter((p) => existsSync(p));
  }

  async tree(): Promise<FileNode[]> {
    const ws = this.userWorkspace;
    if (!ws) return [];
    const entries = await ws.list('.', { recursive: true, maxEntries: 8000 });
    const root: FileNode[] = [];
    const dirs = new Map<string, FileNode>();
    // Godot bookkeeping files (*.import, *.uid) are hidden like in the Godot editor.
    const visible = entries.filter((e) => !(e.type === 'file' && /\.(import|uid)$/.test(e.path)));
    for (const entry of visible.sort((a, b) => a.path.localeCompare(b.path))) {
      const name = entry.path.split('/').pop()!;
      const node: FileNode = {
        path: entry.path,
        name,
        type: entry.type,
        ...(entry.size !== undefined ? { size: entry.size } : {}),
        ...(entry.type === 'directory' ? { children: [] } : {}),
      };
      if (entry.type === 'directory') dirs.set(entry.path, node);
      const parent = entry.path.includes('/')
        ? dirs.get(entry.path.slice(0, entry.path.lastIndexOf('/')))
        : null;
      (parent?.children ?? root).push(node);
    }
    const sort = (nodes: FileNode[]) => {
      nodes.sort((a, b) =>
        a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'directory' ? -1 : 1,
      );
      for (const n of nodes) if (n.children) sort(n.children);
    };
    sort(root);
    return root;
  }

  async readFile(file: string): Promise<string> {
    if (!this.userWorkspace) throw new GameForgeError('PROJECT_NOT_FOUND', 'No project is open.');
    return this.userWorkspace.readText(file);
  }

  async writeFile(file: string, content: string): Promise<void> {
    if (!this.userWorkspace) throw new GameForgeError('PROJECT_NOT_FOUND', 'No project is open.');
    await this.userWorkspace.writeText(file, content, 'user');
  }

  private startWatcher(root: string): void {
    try {
      this.watcher = watch(root, { recursive: true }, (_event, filename) => {
        if (!filename) return;
        const rel = filename.toString().split(path.sep).join('/');
        if (/^(\.git|\.godot|\.gameforge|node_modules)(\/|$)/.test(rel)) return;
        this.changedPaths.add(rel);
        if (this.watchTimer) clearTimeout(this.watchTimer);
        this.watchTimer = setTimeout(() => {
          this.options.send('files-changed', { paths: [...this.changedPaths] });
          this.changedPaths.clear();
        }, 300);
      });
    } catch (error) {
      this.app.logger.warn('File watching is not available', error);
    }
  }

  // ------------------------------------------------------------ AI

  private beginOperation(): AbortSignal {
    this.abort?.abort();
    this.abort = new AbortController();
    return this.abort.signal;
  }

  cancel(): void {
    this.abort?.abort();
    this.abort = null;
  }

  resetChat(): void {
    this.history = [];
  }

  plan(description: string, previous?: GamePlan, feedback?: string): Promise<GamePlan> {
    const signal = this.beginOperation();
    return this.app.generatePlan(description, {
      signal,
      onEvent: this.emit,
      ...(previous ? { previous } : {}),
      ...(feedback ? { feedback } : {}),
    });
  }

  async createGame(request: CreateGameRequest): Promise<CreateGameView> {
    const signal = this.beginOperation();
    mkdirSync(request.parentDir, { recursive: true });
    const result = await this.app.createGame(request.plan, {
      parentDir: request.parentDir,
      ...(request.folderName ? { folderName: request.folderName } : {}),
      initGit: request.initGit,
      signal,
      onEvent: this.emit,
    });
    await this.openProject(result.root);
    // Keep the creation session's tracked AI changes (direct mode) for review.
    this.project = result.project;
    const changes = result.project.pendingChanges();
    this.options.send('changes-updated', changes);
    return {
      root: result.root,
      files: result.files.length,
      customFeatures: result.customFeatures,
      tests: result.tests,
      validation: result.validation,
      changes,
    };
  }

  async chat(message: string): Promise<ChatOutcomeView> {
    if (!this.project) {
      if (/\b(create|make|build)\b.*\bgame\b/i.test(message))
        return { kind: 'action', action: 'create-game', description: message };
      return {
        kind: 'no-project',
        message: 'Open a project or create a new game first — then I can work on it.',
      };
    }
    const signal = this.beginOperation();
    const outcome = await this.project.chat(message, {
      signal,
      onEvent: this.emit,
      history: this.history,
    });
    if (outcome.kind === 'agent') {
      this.history = outcome.result.messages.slice(-MAX_HISTORY);
      // History must start with a user turn.
      while (this.history.length && this.history[0]!.role !== 'user') this.history.shift();
      this.options.send('changes-updated', outcome.changes);
      return {
        kind: 'agent',
        status: outcome.result.status,
        summary: outcome.result.summary,
        changes: outcome.changes,
      };
    }
    if (outcome.action === 'run-game') this.startPreview('play');
    return outcome;
  }

  async aiEdit(
    file: string,
    instruction: string,
    selection?: { startLine: number; endLine: number; text: string },
  ): Promise<ChatOutcomeView> {
    const project = this.requireProject();
    const signal = this.beginOperation();
    const result = await project.aiEdit(file, instruction, selection, {
      signal,
      onEvent: this.emit,
    });
    const changes = project.pendingChanges();
    this.options.send('changes-updated', changes);
    return { kind: 'agent', status: result.status, summary: result.summary, changes };
  }

  // ------------------------------------------------------------ analysis & changes

  analyze() {
    return this.requireProject().analyze();
  }

  fixPlan(filter: {
    severities?: ('critical' | 'high' | 'medium' | 'low' | 'info')[];
    issueIds?: string[];
  }): FixPlan {
    const project = this.requireProject();
    const report = project.lastAnalysis;
    if (!report) throw new GameForgeError('INVALID_INPUT', 'Analyze the project first.');
    return project.createFixPlan(report, filter);
  }

  async applyFixPlan(plan: FixPlan): Promise<FixResultView> {
    const project = this.requireProject();
    const signal = this.beginOperation();
    const result = await project.applyFixPlan(plan, { signal, onEvent: this.emit });
    this.options.send('changes-updated', result.changes);
    return {
      autoFixed: result.autoFixed,
      resolved: result.resolved,
      remaining: result.remaining.length,
      aiSummary: result.aiRun?.summary ?? null,
      changes: result.changes,
    };
  }

  validate() {
    return this.requireProject().validate({ onEvent: this.emit });
  }

  pendingChanges() {
    return this.project?.pendingChanges() ?? [];
  }

  getChange(file: string): FileChange | null {
    return this.project?.getChange(file) ?? null;
  }

  async applyChanges(paths?: string[]) {
    const project = this.requireProject();
    const summary = project.pendingChanges().filter((c) => !paths || paths.includes(c.path));
    const applied = await project.applyChanges(paths);
    this.lastApplied = applied;
    this.options.send('changes-updated', project.pendingChanges());
    return summary;
  }

  async discardChanges(paths?: string[]) {
    const project = this.requireProject();
    await project.discardChanges(paths);
    this.options.send('changes-updated', project.pendingChanges());
  }

  /** Undo the last "Apply" using the recorded original contents. */
  async revertApplied(): Promise<number> {
    const ws = this.userWorkspace;
    if (!ws) return 0;
    let count = 0;
    for (const change of this.lastApplied) {
      if (change.before === null) {
        const { rm } = await import('node:fs/promises');
        await rm(ws.resolve(change.path).abs, { force: true });
      } else {
        await ws.writeText(change.path, change.before, 'user');
      }
      count++;
    }
    this.lastApplied = [];
    return count;
  }

  // ------------------------------------------------------------ engine

  async runTests() {
    return this.requireProject().runTests({ onEvent: this.emit });
  }

  async runGame(mode: 'play' | 'debug'): Promise<GameStatus> {
    const project = this.requireProject();
    this.stopGame();
    const previewFile = path.join(project.root, '.gameforge', 'preview.png');
    this.lastPreviewMtime = existsSync(previewFile) ? statSync(previewFile).mtimeMs : 0;
    const game = await project.runGame(mode, { onEvent: this.emit });
    this.game = game;
    this.gameMode = mode;
    game.onExit(() => {
      if (this.game === game) {
        this.game = null;
        this.stopPreview();
        this.options.send('game', { running: false });
      }
    });
    this.startPreview(mode);
    return this.gameStatus();
  }

  stopGame(): GameStatus {
    // Through the session first, so the exit is reported as "Game stopped." rather than a failure.
    this.project?.stopGame();
    this.game?.stop();
    this.game = null;
    this.stopPreview();
    this.options.send('game', { running: false });
    return { running: false };
  }

  gameStatus(): GameStatus {
    return this.game
      ? { running: true, ...(this.gameMode ? { mode: this.gameMode } : {}) }
      : { running: false };
  }

  private startPreview(mode: 'play' | 'debug'): void {
    this.options.send('game', { running: true, mode });
    this.stopPreview();
    const project = this.project;
    if (!project) return;
    const file = path.join(project.root, '.gameforge', 'preview.png');
    this.previewTimer = setInterval(() => {
      try {
        if (!existsSync(file)) return;
        const mtime = statSync(file).mtimeMs;
        if (mtime <= this.lastPreviewMtime) return;
        this.lastPreviewMtime = mtime;
        const data = readFileSync(file);
        if (data.length < 8 || data[1] !== 0x50) return; // not a complete PNG
        this.options.send('preview', {
          dataUrl: `data:image/png;base64,${data.toString('base64')}`,
          at: Date.now(),
        });
      } catch {
        // Frame was being written — try again next tick.
      }
    }, 400);
  }

  private stopPreview(): void {
    if (this.previewTimer) clearInterval(this.previewTimer);
    this.previewTimer = null;
  }

  // ------------------------------------------------------------ git & terminal

  private get root(): string {
    return this.requireProject().root;
  }

  gitStatus() {
    return this.app.git.status(this.root);
  }

  gitDiff(file?: string, staged?: boolean) {
    return this.app.git.diff(this.root, {
      ...(file ? { path: file } : {}),
      staged: staged ?? false,
    });
  }

  gitLog() {
    return this.app.git.log(this.root, 100);
  }

  gitBranches() {
    return this.app.git.branches(this.root);
  }

  async gitInit() {
    await this.app.git.init(this.root);
    return this.app.git.status(this.root);
  }

  gitCommit(message: string) {
    return this.app.git.commit(this.root, message);
  }

  gitCreateBranch(name: string) {
    return this.app.git.createBranch(this.root, name, true);
  }

  gitCheckout(name: string) {
    return this.app.git.checkout(this.root, name);
  }

  gitDiscard(paths: string[]) {
    return this.app.git.discard(this.root, paths);
  }

  /** Explicit user action from the Git panel (with confirmation in the UI). */
  gitPush() {
    this.app.logger.info('User pushed to the remote');
    return this.app.git.push(this.root);
  }

  /** Commands typed by the user in the Terminal panel: no shell, sanitized env, project folder. */
  async terminal(command: string) {
    const argv = parseCommand(command);
    const id = randomUUID().slice(0, 8);
    this.app.logger.info(`Terminal [${id}]: ${command}`);
    return runCommand(argv, {
      cwd: this.root,
      timeoutMs: 10 * 60_000,
      onOutput: (stream, text) => this.emit({ type: 'output', source: 'command', stream, text }),
    });
  }

  logs() {
    return this.app.logHub.recent(1000);
  }

  async dispose(): Promise<void> {
    await this.closeProject();
    for (const resolve of this.pendingConfirms.values()) resolve('deny');
    this.pendingConfirms.clear();
    await this.app?.plugins.deactivateAll();
  }
}
