import { useSyncExternalStore } from 'react';
import type {
  AnalysisReport,
  AppInfo,
  ChangeSummary,
  ConfirmationRequest,
  EngineInstallation,
  FileNode,
  GameStatus,
  LogEntry,
  ProjectView,
  SettingsView,
  TestRunReport,
  UserFacingError,
} from '@shared/api';

export type ChatItem =
  | { id: string; kind: 'user'; text: string }
  | {
      id: string;
      kind: 'agent';
      runId: string;
      parentRunId?: string;
      agent: string;
      agentName: string;
      text: string;
      status: 'working' | 'done' | 'failed' | 'cancelled' | 'max_steps' | 'refused';
      tools: { callId: string; tool: string; ok?: boolean; detail?: string }[];
    }
  | {
      id: string;
      kind: 'step';
      step: string;
      label: string;
      agent: string;
      status: string;
      detail?: string;
    }
  | { id: string; kind: 'notice'; level: 'info' | 'warn' | 'error' | 'success'; text: string }
  | { id: string; kind: 'error'; error: UserFacingError }
  | { id: string; kind: 'changes'; changes: ChangeSummary[] };

export type TabKind = 'welcome' | 'preview' | 'file' | 'analysis' | 'changes' | 'git-diff';

export interface Tab {
  id: string;
  kind: TabKind;
  title: string;
  path?: string;
  dirty?: boolean;
  line?: number;
}

export interface OutputLine {
  id: number;
  source: string;
  stream: 'stdout' | 'stderr' | 'cmd';
  text: string;
}

export interface Toast {
  id: string;
  level: 'info' | 'success' | 'warn' | 'error';
  title: string;
  text?: string;
}

export type BottomTab = 'terminal' | 'logs' | 'tests' | 'git' | 'problems';

export interface AppState {
  info: AppInfo | null;
  settings: SettingsView | null;
  engine: EngineInstallation | null | undefined;
  project: ProjectView | null;
  recent: string[];
  tree: FileNode[];
  tabs: Tab[];
  activeTab: string;
  chat: ChatItem[];
  busy: boolean;
  agents: Record<string, 'idle' | 'working'>;
  changes: ChangeSummary[];
  analysis: AnalysisReport | null;
  tests: TestRunReport | null;
  testsRunning: boolean;
  game: GameStatus;
  preview: string | null;
  output: OutputLine[];
  logs: LogEntry[];
  confirms: ConfirmationRequest[];
  toasts: Toast[];
  dialogs: {
    create: { open: boolean; description?: string };
    settings: { open: boolean; section?: string };
    palette: { open: boolean; mode: 'commands' | 'files' };
    godotMissing: boolean;
  };
  layout: {
    sidebar: boolean;
    ai: boolean;
    bottom: boolean;
    bottomTab: BottomTab;
    sidebarWidth: number;
    aiWidth: number;
    bottomHeight: number;
  };
  /** Request from anywhere to focus the chat input. */
  focusChat: number;
  /** Jump-to-line requests for the editor. */
  reveal: { path: string; line: number; at: number } | null;
}

const LAYOUT_KEY = 'gameforge.layout';

function loadLayout(): AppState['layout'] {
  const fallback: AppState['layout'] = {
    sidebar: true,
    ai: true,
    bottom: true,
    bottomTab: 'terminal',
    sidebarWidth: 250,
    aiWidth: 380,
    bottomHeight: 220,
  };
  try {
    return {
      ...fallback,
      ...(JSON.parse(localStorage.getItem(LAYOUT_KEY) ?? '{}') as Partial<AppState['layout']>),
    };
  } catch {
    return fallback;
  }
}

export const WELCOME_TAB: Tab = { id: 'welcome', kind: 'welcome', title: 'Welcome' };
export const PREVIEW_TAB: Tab = { id: 'preview', kind: 'preview', title: 'Game Preview' };

export const AGENT_IDS = [
  'orchestrator',
  'game-designer',
  'programmer',
  'level-designer',
  'asset-manager',
  'audio-designer',
  'qa',
] as const;

export function initialState(): AppState {
  return {
    info: null,
    settings: null,
    engine: undefined,
    project: null,
    recent: [],
    tree: [],
    tabs: [WELCOME_TAB],
    activeTab: WELCOME_TAB.id,
    chat: [],
    busy: false,
    agents: Object.fromEntries(AGENT_IDS.map((id) => [id, 'idle'])),
    changes: [],
    analysis: null,
    tests: null,
    testsRunning: false,
    game: { running: false },
    preview: null,
    output: [],
    logs: [],
    confirms: [],
    toasts: [],
    dialogs: {
      create: { open: false },
      settings: { open: false },
      palette: { open: false, mode: 'commands' },
      godotMissing: false,
    },
    layout: loadLayout(),
    focusChat: 0,
    reveal: null,
  };
}

type Listener = () => void;

/** Minimal external store (no extra dependency). */
export class Store {
  private state: AppState;
  private readonly listeners = new Set<Listener>();

  constructor(state: AppState = initialState()) {
    this.state = state;
  }

  get = (): AppState => this.state;

  set = (update: Partial<AppState> | ((state: AppState) => Partial<AppState>)): void => {
    const patch = typeof update === 'function' ? update(this.state) : update;
    this.state = { ...this.state, ...patch };
    if (patch.layout) {
      try {
        localStorage.setItem(LAYOUT_KEY, JSON.stringify(this.state.layout));
      } catch {
        // storage unavailable — layout just isn't remembered
      }
    }
    for (const listener of this.listeners) listener();
  };

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
}

export const store = new Store();

export function useStore<T>(selector: (state: AppState) => T): T {
  return useSyncExternalStore(store.subscribe, () => selector(store.get()));
}

let counter = 0;
export const uid = (prefix = 'id') =>
  `${prefix}-${Date.now().toString(36)}-${(counter++).toString(36)}`;
