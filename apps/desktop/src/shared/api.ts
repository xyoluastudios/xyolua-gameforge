/**
 * IPC contract between the Electron main process and the renderer.
 * Types only — no runtime code, so both sides can import it.
 */
import type {
  AnalysisReport,
  ChangeSummary,
  CommandResult,
  ConfirmationDecision,
  ConfirmationRequest,
  DoctorReport,
  EngineInstallation,
  FileChange,
  FixPlan,
  GameForgeEvent,
  GamePlan,
  GitCommit,
  GitStatus,
  HealthResult,
  IssueSeverity,
  LogEntry,
  PluginInfo,
  ProjectIssue,
  TestRunReport,
  UserFacingError,
  ValidationResult,
} from '@gameforge/core';

export type {
  AnalysisReport,
  ChangeSummary,
  CommandResult,
  ConfirmationDecision,
  ConfirmationRequest,
  DoctorReport,
  EngineInstallation,
  FileChange,
  FixPlan,
  GameForgeEvent,
  GamePlan,
  GitCommit,
  GitStatus,
  HealthResult,
  IssueSeverity,
  LogEntry,
  PluginInfo,
  ProjectIssue,
  TestRunReport,
  UserFacingError,
  ValidationResult,
};

export interface AppInfo {
  version: string;
  platform: NodeJS.Platform;
  configDir: string;
  pluginDir: string;
  /** Default parent folder for new games. */
  defaultProjectsDir: string;
  e2e: boolean;
}

export interface ProviderOption {
  id: string;
  displayName: string;
  description: string;
}

export interface SettingsView {
  provider: string | null;
  providers: ProviderOption[];
  anthropic: {
    model: string;
    effort: string;
    fallbacks: boolean;
    baseUrl?: string;
    hasKey: boolean;
    keySource: 'env' | 'keychain' | null;
  };
  openai: {
    baseUrl: string;
    model?: string;
    jsonMode: boolean;
    hasKey: boolean;
    keySource: 'env' | 'keychain' | null;
  };
  ollama: { baseUrl: string; model?: string };
  godot: { executable?: string };
  agents: { changeMode: 'staged' | 'direct'; maxSteps: number };
  mcp: { enabled: boolean; allowWrite: boolean; command: string };
  /** True when the OS keychain can encrypt API keys. */
  secureStorage: boolean;
  /** The active provider and model, as a short label. */
  activeLabel: string;
  generative: boolean;
}

export interface SettingsPatch {
  provider?: string | null;
  anthropic?: { model?: string; effort?: string; fallbacks?: boolean; baseUrl?: string };
  openai?: { baseUrl?: string; model?: string; jsonMode?: boolean };
  ollama?: { baseUrl?: string; model?: string };
  godot?: { executable?: string | null };
  agents?: { changeMode?: 'staged' | 'direct'; maxSteps?: number };
  mcp?: { enabled?: boolean; allowWrite?: boolean };
}

export interface FileNode {
  path: string;
  name: string;
  type: 'file' | 'directory';
  size?: number;
  children?: FileNode[];
}

export interface ProjectView {
  root: string;
  name: string;
  engine: string | null;
  isGit: boolean;
  mainScene?: string;
}

export interface CreateGameRequest {
  plan: GamePlan;
  parentDir: string;
  folderName?: string;
  initGit: boolean;
}

export interface CreateGameView {
  root: string;
  files: number;
  customFeatures: string[];
  tests: TestRunReport | null;
  validation: ValidationResult | null;
  changes: ChangeSummary[];
}

export type ChatOutcomeView =
  | { kind: 'agent'; status: string; summary: string; changes: ChangeSummary[] }
  | { kind: 'action'; action: 'run-tests'; report: TestRunReport }
  | { kind: 'action'; action: 'run-game' }
  | { kind: 'action'; action: 'analyze'; report: AnalysisReport }
  | { kind: 'action'; action: 'fix-plan'; plan: FixPlan; report: AnalysisReport }
  | { kind: 'action'; action: 'git-status'; text: string }
  | { kind: 'action'; action: 'create-game'; description: string }
  | { kind: 'no-project'; message: string };

export interface FixResultView {
  autoFixed: string[];
  resolved: string[];
  remaining: number;
  aiSummary: string | null;
  changes: ChangeSummary[];
}

export interface GameStatus {
  running: boolean;
  mode?: 'play' | 'debug';
}

/** Request/response channels: name → [args, result]. */
export interface InvokeMap {
  'app:info': [[], AppInfo];
  'app:open-external': [[url: string], void];
  'settings:get': [[], SettingsView];
  'settings:save': [[patch: SettingsPatch], SettingsView];
  'settings:set-key': [[provider: 'anthropic' | 'openai', key: string | null], SettingsView];
  'settings:test-provider': [[], HealthResult];
  'dialog:select-folder': [[title?: string], string | null];
  'dialog:select-godot': [[], string | null];
  'engine:detect': [[], EngineInstallation | null];
  'project:open': [[root: string], ProjectView];
  'project:close': [[], void];
  'project:current': [[], ProjectView | null];
  'project:recent': [[], string[]];
  'project:tree': [[], FileNode[]];
  'project:read-file': [[path: string], string];
  'project:write-file': [[path: string, content: string], void];
  'ai:plan': [[description: string, previous?: GamePlan, feedback?: string], GamePlan];
  'ai:create': [[request: CreateGameRequest], CreateGameView];
  'ai:chat': [[message: string], ChatOutcomeView];
  'ai:edit': [
    [
      file: string,
      instruction: string,
      selection?: { startLine: number; endLine: number; text: string },
    ],
    ChatOutcomeView,
  ];
  'ai:cancel': [[], void];
  'ai:reset-chat': [[], void];
  'analysis:run': [[], AnalysisReport];
  'analysis:fix-plan': [[filter: { severities?: IssueSeverity[]; issueIds?: string[] }], FixPlan];
  'analysis:apply-fix-plan': [[plan: FixPlan], FixResultView];
  'analysis:validate': [[], ValidationResult];
  'changes:list': [[], ChangeSummary[]];
  'changes:get': [[path: string], FileChange | null];
  'changes:apply': [[paths?: string[]], ChangeSummary[]];
  'changes:discard': [[paths?: string[]], void];
  'changes:revert-applied': [[], number];
  'game:run': [[mode: 'play' | 'debug'], GameStatus];
  'game:stop': [[], GameStatus];
  'game:status': [[], GameStatus];
  'tests:run': [[], TestRunReport];
  'git:status': [[], GitStatus];
  'git:diff': [[path?: string, staged?: boolean], string];
  'git:log': [[], GitCommit[]];
  'git:branches': [[], { current: string | null; all: string[] }];
  'git:init': [[], GitStatus];
  'git:commit': [[message: string], string];
  'git:create-branch': [[name: string], void];
  'git:checkout': [[name: string], void];
  'git:discard': [[paths: string[]], void];
  'git:push': [[], string];
  'terminal:run': [[command: string], CommandResult];
  'logs:recent': [[], LogEntry[]];
  'plugins:list': [[], PluginInfo[]];
  'plugins:set-enabled': [[id: string, enabled: boolean], PluginInfo[]];
  'doctor:run': [[online: boolean], DoctorReport];
  'confirm:respond': [[id: string, decision: ConfirmationDecision], void];
}

export type InvokeChannel = keyof InvokeMap;

/** Events pushed from main to renderer. */
export interface EventMap {
  event: GameForgeEvent;
  confirm: ConfirmationRequest;
  log: LogEntry;
  preview: { dataUrl: string; at: number };
  game: GameStatus;
  'files-changed': { paths: string[] };
  'changes-updated': ChangeSummary[];
}

export type EventChannel = keyof EventMap;

/** Wire format of every invoke result (errors keep their user-facing shape). */
export type IpcResult<T> = { ok: true; value: T } | { ok: false; error: UserFacingError };

export interface GameForgeBridge {
  invoke<C extends InvokeChannel>(
    channel: C,
    ...args: InvokeMap[C][0]
  ): Promise<IpcResult<InvokeMap[C][1]>>;
  on<E extends EventChannel>(channel: E, listener: (payload: EventMap[E]) => void): () => void;
}

export const INVOKE_CHANNELS: readonly InvokeChannel[] = [
  'app:info',
  'app:open-external',
  'settings:get',
  'settings:save',
  'settings:set-key',
  'settings:test-provider',
  'dialog:select-folder',
  'dialog:select-godot',
  'engine:detect',
  'project:open',
  'project:close',
  'project:current',
  'project:recent',
  'project:tree',
  'project:read-file',
  'project:write-file',
  'ai:plan',
  'ai:create',
  'ai:chat',
  'ai:edit',
  'ai:cancel',
  'ai:reset-chat',
  'analysis:run',
  'analysis:fix-plan',
  'analysis:apply-fix-plan',
  'analysis:validate',
  'changes:list',
  'changes:get',
  'changes:apply',
  'changes:discard',
  'changes:revert-applied',
  'game:run',
  'game:stop',
  'game:status',
  'tests:run',
  'git:status',
  'git:diff',
  'git:log',
  'git:branches',
  'git:init',
  'git:commit',
  'git:create-branch',
  'git:checkout',
  'git:discard',
  'git:push',
  'terminal:run',
  'logs:recent',
  'plugins:list',
  'plugins:set-enabled',
  'doctor:run',
  'confirm:respond',
] as const;

export const EVENT_CHANNELS: readonly EventChannel[] = [
  'event',
  'confirm',
  'log',
  'preview',
  'game',
  'files-changed',
  'changes-updated',
] as const;
