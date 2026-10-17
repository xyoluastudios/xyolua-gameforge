import type { ChatOutcomeView, GameForgeEvent, IssueSeverity, UserFacingError } from '@shared/api';
import { asUserError, call } from './api';
import { PREVIEW_TAB, store, uid, type ChatItem, type Tab, type Toast } from './store';

/** All user-facing actions live here so the palette, shortcuts and UI share them. */

export function toast(level: Toast['level'], title: string, text?: string): void {
  const id = uid('toast');
  store.set((s) => ({ toasts: [...s.toasts, { id, level, title, ...(text ? { text } : {}) }] }));
  setTimeout(
    () => store.set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
    level === 'error' ? 9000 : 4500,
  );
}

export function showError(error: unknown, title?: string): UserFacingError {
  const e = asUserError(error);
  toast('error', title ?? e.message, [e.reason, e.solution].filter(Boolean).join(' — '));
  return e;
}

function pushChat(item: ChatItem): void {
  store.set((s) => ({ chat: [...s.chat, item].slice(-400) }));
}

export function setLayout(patch: Partial<ReturnType<typeof store.get>['layout']>): void {
  store.set((s) => ({ layout: { ...s.layout, ...patch } }));
}

// ------------------------------------------------------------ tabs

export function openTab(tab: Tab): void {
  store.set((s) => ({
    tabs: s.tabs.some((t) => t.id === tab.id)
      ? s.tabs.map((t) => (t.id === tab.id ? { ...t, ...tab, dirty: t.dirty } : t))
      : [...s.tabs.filter((t) => t.kind !== 'welcome'), tab],
    activeTab: tab.id,
  }));
}

export function openFile(path: string, line?: number): void {
  openTab({
    id: `file:${path}`,
    kind: 'file',
    title: path.split('/').pop() ?? path,
    path,
    ...(line ? { line } : {}),
  });
  if (line) store.set({ reveal: { path, line, at: Date.now() } });
}

export function closeTab(id: string): void {
  store.set((s) => {
    const index = s.tabs.findIndex((t) => t.id === id);
    const tab = s.tabs[index];
    if (tab?.dirty && !window.confirm(`${tab.title} has unsaved changes. Close anyway?`)) return {};
    const tabs = s.tabs.filter((t) => t.id !== id);
    const nextActive =
      s.activeTab === id ? (tabs[Math.min(index, tabs.length - 1)]?.id ?? '') : s.activeTab;
    if (tabs.length === 0)
      return {
        tabs: s.project ? [PREVIEW_TAB] : [{ id: 'welcome', kind: 'welcome', title: 'Welcome' }],
        activeTab: s.project ? PREVIEW_TAB.id : 'welcome',
      };
    return { tabs, activeTab: nextActive };
  });
}

export function markDirty(id: string, dirty: boolean): void {
  store.set((s) => ({ tabs: s.tabs.map((t) => (t.id === id ? { ...t, dirty } : t)) }));
}

// ------------------------------------------------------------ app bootstrap

export async function refreshSettings(): Promise<void> {
  try {
    store.set({ settings: await call('settings:get') });
  } catch (error) {
    showError(error);
  }
}

export async function detectEngine(): Promise<void> {
  try {
    store.set({ engine: await call('engine:detect') });
  } catch {
    store.set({ engine: null });
  }
}

export async function refreshTree(): Promise<void> {
  if (!store.get().project) return;
  try {
    store.set({ tree: await call('project:tree') });
  } catch (error) {
    showError(error, 'Could not read the project files');
  }
}

export async function refreshChanges(): Promise<void> {
  try {
    store.set({ changes: await call('changes:list') });
  } catch {
    // no project
  }
}

// ------------------------------------------------------------ project

export async function openProject(root?: string): Promise<void> {
  try {
    const target = root ?? (await call('dialog:select-folder', 'Open a Godot project'));
    if (!target) return;
    const project = await call('project:open', target);
    afterProjectOpened(project);
    if (!project.engine)
      toast(
        'warn',
        'Not a Godot project',
        'No project.godot found. Some features are unavailable.',
      );
  } catch (error) {
    showError(error, 'Could not open the project');
  }
}

export function afterProjectOpened(
  project: NonNullable<ReturnType<typeof store.get>['project']>,
): void {
  store.set({
    project,
    tabs: [PREVIEW_TAB],
    activeTab: PREVIEW_TAB.id,
    analysis: null,
    tests: null,
    preview: null,
    chat: [],
    changes: [],
  });
  void refreshTree();
  void refreshChanges();
  void call('project:recent').then((recent) => store.set({ recent }));
}

export async function closeProject(): Promise<void> {
  await call('project:close');
  store.set({
    project: null,
    tree: [],
    tabs: [{ id: 'welcome', kind: 'welcome', title: 'Welcome' }],
    activeTab: 'welcome',
    analysis: null,
    changes: [],
    chat: [],
    preview: null,
  });
}

export function createGame(description?: string): void {
  store.set({
    dialogs: {
      ...store.get().dialogs,
      create: { open: true, ...(description ? { description } : {}) },
    },
  });
}

export function openSettings(section?: string): void {
  store.set({
    dialogs: { ...store.get().dialogs, settings: { open: true, ...(section ? { section } : {}) } },
  });
}

export function openPalette(mode: 'commands' | 'files' = 'commands'): void {
  store.set({ dialogs: { ...store.get().dialogs, palette: { open: true, mode } } });
}

// ------------------------------------------------------------ game

async function ensureGodot(): Promise<boolean> {
  if (store.get().engine === undefined) await detectEngine();
  if (store.get().engine) return true;
  store.set({ dialogs: { ...store.get().dialogs, godotMissing: true } });
  return false;
}

export async function runGame(mode: 'play' | 'debug' = 'play'): Promise<void> {
  if (!store.get().project || !(await ensureGodot())) return;
  try {
    openTab(PREVIEW_TAB);
    setLayout({ bottom: true, bottomTab: 'terminal' });
    store.set({ game: await call('game:run', mode), preview: null });
  } catch (error) {
    showError(error, 'Could not start the game');
  }
}

export async function stopGame(): Promise<void> {
  try {
    store.set({ game: await call('game:stop') });
  } catch (error) {
    showError(error);
  }
}

export async function restartGame(): Promise<void> {
  await stopGame();
  await runGame(store.get().game.mode ?? 'play');
}

export async function runTests(): Promise<void> {
  if (!store.get().project || !(await ensureGodot())) return;
  store.set({ testsRunning: true });
  setLayout({ bottom: true, bottomTab: 'tests' });
  try {
    const tests = await call('tests:run');
    store.set({ tests });
    if (tests.error) toast('warn', tests.error.message, tests.error.solution);
    else
      toast(
        tests.ok ? 'success' : 'error',
        tests.ok
          ? `All ${tests.total} tests passed`
          : `${tests.failed} of ${tests.total} tests failed`,
      );
  } catch (error) {
    showError(error, 'Tests could not run');
  } finally {
    store.set({ testsRunning: false });
  }
}

// ------------------------------------------------------------ analysis

export async function analyze(): Promise<void> {
  if (!store.get().project) return;
  try {
    openTab({ id: 'analysis', kind: 'analysis', title: 'Project Analysis' });
    const analysis = await call('analysis:run');
    store.set({ analysis });
  } catch (error) {
    showError(error, 'Analysis failed');
  }
}

export async function fixIssues(filter: { severities?: IssueSeverity[]; issueIds?: string[] }) {
  if (!store.get().analysis) await analyze();
  return call('analysis:fix-plan', filter);
}

// ------------------------------------------------------------ changes

export async function applyChanges(paths?: string[]): Promise<void> {
  try {
    const applied = await call('changes:apply', paths);
    await refreshChanges();
    toast(
      'success',
      `Applied ${applied.length} change${applied.length === 1 ? '' : 's'}`,
      store.get().engine ? 'Running tests…' : undefined,
    );
    void refreshTree();
    if (store.get().engine) void runTests();
  } catch (error) {
    showError(error, 'Could not apply the changes');
  }
}

export async function discardChanges(paths?: string[]): Promise<void> {
  try {
    await call('changes:discard', paths);
    await refreshChanges();
    void refreshTree();
    toast('info', 'Changes discarded');
  } catch (error) {
    showError(error);
  }
}

export function reviewChanges(): void {
  openTab({ id: 'changes', kind: 'changes', title: 'Review Changes' });
}

// ------------------------------------------------------------ AI

export async function sendChat(message: string): Promise<ChatOutcomeView | null> {
  const text = message.trim();
  if (!text || store.get().busy) return null;
  pushChat({ id: uid('u'), kind: 'user', text });
  store.set({ busy: true });
  try {
    const outcome = await call('ai:chat', text);
    handleOutcome(outcome);
    return outcome;
  } catch (error) {
    pushChat({ id: uid('e'), kind: 'error', error: asUserError(error) });
    return null;
  } finally {
    store.set({ busy: false });
  }
}

export function handleOutcome(outcome: ChatOutcomeView): void {
  switch (outcome.kind) {
    case 'no-project':
      pushChat({ id: uid('n'), kind: 'notice', level: 'info', text: outcome.message });
      break;
    case 'agent':
      if (outcome.changes.length)
        pushChat({ id: uid('c'), kind: 'changes', changes: outcome.changes });
      break;
    case 'action':
      switch (outcome.action) {
        case 'create-game':
          createGame(outcome.description);
          pushChat({
            id: uid('n'),
            kind: 'notice',
            level: 'info',
            text: 'Opening Create Game — review the plan before anything is generated.',
          });
          break;
        case 'run-tests':
          store.set({ tests: outcome.report });
          setLayout({ bottom: true, bottomTab: 'tests' });
          pushChat({
            id: uid('n'),
            kind: 'notice',
            level: outcome.report.ok ? 'success' : 'error',
            text: outcome.report.error
              ? `${outcome.report.error.message} ${outcome.report.error.solution ?? ''}`
              : `Tests: ${outcome.report.passed}/${outcome.report.total} passed, ${outcome.report.failed} failed.`,
          });
          break;
        case 'run-game':
          openTab(PREVIEW_TAB);
          pushChat({
            id: uid('n'),
            kind: 'notice',
            level: 'info',
            text: 'Game started — output is in the Terminal panel.',
          });
          break;
        case 'analyze':
          store.set({ analysis: outcome.report });
          openTab({ id: 'analysis', kind: 'analysis', title: 'Project Analysis' });
          pushChat({
            id: uid('n'),
            kind: 'notice',
            level: 'info',
            text: `Analysis done: ${outcome.report.issues.length} issues found.`,
          });
          break;
        case 'fix-plan':
          store.set({ analysis: outcome.report });
          openTab({ id: 'analysis', kind: 'analysis', title: 'Project Analysis' });
          pushChat({
            id: uid('n'),
            kind: 'notice',
            level: 'info',
            text: `Fix plan ready: ${outcome.plan.items.length} issue(s). Review it in Project Analysis.`,
          });
          break;
        case 'git-status':
          setLayout({ bottom: true, bottomTab: 'git' });
          pushChat({ id: uid('n'), kind: 'notice', level: 'info', text: outcome.text });
          break;
      }
  }
}

export async function cancelAI(): Promise<void> {
  await call('ai:cancel');
}

export function newChat(): void {
  store.set({ chat: [] });
  void call('ai:reset-chat');
}

// ------------------------------------------------------------ events from main

export function handleEvent(event: GameForgeEvent): void {
  const s = store.get();
  switch (event.type) {
    case 'agent:start':
      store.set({ agents: { ...s.agents, [event.agent]: 'working' } });
      pushChat({
        id: uid('a'),
        kind: 'agent',
        runId: event.runId,
        ...(event.parentRunId ? { parentRunId: event.parentRunId } : {}),
        agent: event.agent,
        agentName: event.agentName,
        text: '',
        status: 'working',
        tools: [],
      });
      break;
    case 'agent:text':
      store.set((state) => ({
        chat: state.chat.map((item) =>
          item.kind === 'agent' && item.runId === event.runId
            ? { ...item, text: item.text + event.delta }
            : item,
        ),
      }));
      break;
    case 'agent:message':
      break;
    case 'tool:start':
      store.set((state) => ({
        chat: state.chat.map((item) =>
          item.kind === 'agent' && item.runId === event.runId
            ? {
                ...item,
                tools: [
                  ...item.tools,
                  { callId: event.callId, tool: event.tool, detail: describeInput(event.input) },
                ],
                text: item.text ? `${item.text.replace(/\s+$/, '')}\n` : '',
              }
            : item,
        ),
      }));
      break;
    case 'tool:end':
      store.set((state) => ({
        chat: state.chat.map((item) =>
          item.kind === 'agent' && item.runId === event.runId
            ? {
                ...item,
                tools: item.tools.map((t) =>
                  t.callId === event.callId
                    ? {
                        ...t,
                        ok: event.result.ok,
                        ...(event.result.ok
                          ? {}
                          : { detail: event.result.output.split('\n')[0]!.slice(0, 160) }),
                      }
                    : t,
                ),
              }
            : item,
        ),
      }));
      if (event.result.ok && ['write_file', 'edit_file', 'delete_file'].includes(event.tool))
        void refreshChanges();
      break;
    case 'agent:end':
      store.set((state) => ({
        agents: { ...state.agents, [event.agent]: 'idle' },
        chat: state.chat.map((item) =>
          item.kind === 'agent' && item.runId === event.runId
            ? { ...item, status: event.status, text: item.text.trim() ? item.text : event.summary }
            : item,
        ),
      }));
      if (event.error) pushChat({ id: uid('e'), kind: 'error', error: event.error });
      break;
    case 'pipeline:step': {
      const existing = s.chat.find(
        (i) => i.kind === 'step' && i.step === event.step && i.status === 'running',
      );
      if (existing) {
        store.set((state) => ({
          chat: state.chat.map((i) =>
            i.id === existing.id
              ? ({
                  ...i,
                  status: event.status,
                  ...(event.detail ? { detail: event.detail } : {}),
                } as ChatItem)
              : i,
          ),
        }));
      } else {
        pushChat({
          id: uid('s'),
          kind: 'step',
          step: event.step,
          label: event.label,
          agent: event.agent,
          status: event.status,
          ...(event.detail ? { detail: event.detail } : {}),
        });
      }
      const agentKey = {
        'Level Designer': 'level-designer',
        Programmer: 'programmer',
        'Asset Manager': 'asset-manager',
        'Audio Designer': 'audio-designer',
        QA: 'qa',
        'Project Manager': 'orchestrator',
      }[event.agent];
      if (agentKey)
        store.set((state) => ({
          agents: { ...state.agents, [agentKey]: event.status === 'running' ? 'working' : 'idle' },
        }));
      break;
    }
    case 'pipeline:file':
      break;
    case 'output':
      appendOutput(event.source, event.stream, event.text);
      break;
    case 'notice':
      pushChat({ id: uid('n'), kind: 'notice', level: event.level, text: event.message });
      break;
  }
}

let outputId = 0;
export function appendOutput(
  source: string,
  stream: 'stdout' | 'stderr' | 'cmd',
  text: string,
): void {
  const lines = text.replace(/\r/g, '').split('\n');
  if (lines.at(-1) === '') lines.pop();
  if (!lines.length) return;
  store.set((s) => ({
    output: [
      ...s.output,
      ...lines.map((line) => ({ id: outputId++, source, stream, text: line })),
    ].slice(-3000),
  }));
}

function describeInput(input: unknown): string | undefined {
  if (!input || typeof input !== 'object') return undefined;
  const value = input as Record<string, unknown>;
  const first = value.path ?? value.command ?? value.query ?? value.agent ?? value.pattern;
  return typeof first === 'string' ? first.slice(0, 120) : undefined;
}
