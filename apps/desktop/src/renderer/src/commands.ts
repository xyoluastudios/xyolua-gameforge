import * as actions from './actions';
import { store } from './store';

export interface Command {
  id: string;
  title: string;
  /** Display form, e.g. "Ctrl+K". Matching is done in matchesShortcut. */
  shortcut?: string;
  /** Hidden from the palette when false. */
  available?: () => boolean;
  run: () => void | Promise<void>;
}

const hasProject = () => store.get().project !== null;

export const COMMANDS: Command[] = [
  { id: 'create-game', title: 'Create Game', shortcut: 'Ctrl+N', run: () => actions.createGame() },
  {
    id: 'open-project',
    title: 'Open Project',
    shortcut: 'Ctrl+O',
    run: () => actions.openProject(),
  },
  {
    id: 'ask-ai',
    title: 'Ask AI',
    shortcut: 'Ctrl+L',
    run: () =>
      store.set((s) => ({ layout: { ...s.layout, ai: true }, focusChat: s.focusChat + 1 })),
  },
  {
    id: 'run-game',
    title: 'Run Game',
    shortcut: 'F5',
    available: hasProject,
    run: () => actions.runGame('play'),
  },
  {
    id: 'debug-game',
    title: 'Debug Game (collision shapes, verbose)',
    shortcut: 'F6',
    available: hasProject,
    run: () => actions.runGame('debug'),
  },
  {
    id: 'stop-game',
    title: 'Stop Game',
    shortcut: 'Shift+F5',
    available: () => store.get().game.running,
    run: () => actions.stopGame(),
  },
  {
    id: 'restart-game',
    title: 'Restart Game',
    shortcut: 'Ctrl+Shift+F5',
    available: () => store.get().game.running,
    run: () => actions.restartGame(),
  },
  {
    id: 'run-tests',
    title: 'Run Tests',
    shortcut: 'Ctrl+Shift+T',
    available: hasProject,
    run: () => actions.runTests(),
  },
  {
    id: 'fix-problems',
    title: 'Fix Problems (analyze and plan fixes)',
    available: hasProject,
    run: () => actions.analyze(),
  },
  {
    id: 'analyze',
    title: 'Analyze Project',
    shortcut: 'Ctrl+Shift+A',
    available: hasProject,
    run: () => actions.analyze(),
  },
  {
    id: 'review-changes',
    title: 'Review AI Changes',
    available: () => store.get().changes.length > 0,
    run: () => actions.reviewChanges(),
  },
  {
    id: 'search-files',
    title: 'Search Files',
    shortcut: 'Ctrl+P',
    available: hasProject,
    run: () => actions.openPalette('files'),
  },
  {
    id: 'git-status',
    title: 'Git Status',
    shortcut: 'Ctrl+Shift+G',
    available: hasProject,
    run: () => actions.setLayout({ bottom: true, bottomTab: 'git' }),
  },
  { id: 'settings', title: 'Settings', shortcut: 'Ctrl+,', run: () => actions.openSettings() },
  { id: 'ai-provider', title: 'Settings: AI Provider', run: () => actions.openSettings('ai') },
  { id: 'godot-settings', title: 'Settings: Godot', run: () => actions.openSettings('godot') },
  {
    id: 'toggle-sidebar',
    title: 'Toggle Project Explorer',
    shortcut: 'Ctrl+B',
    run: () => actions.setLayout({ sidebar: !store.get().layout.sidebar }),
  },
  {
    id: 'toggle-ai',
    title: 'Toggle AI Agent Panel',
    shortcut: 'Ctrl+Alt+B',
    run: () => actions.setLayout({ ai: !store.get().layout.ai }),
  },
  {
    id: 'toggle-panel',
    title: 'Toggle Terminal / Logs Panel',
    shortcut: 'Ctrl+J',
    run: () => actions.setLayout({ bottom: !store.get().layout.bottom }),
  },
  {
    id: 'show-logs',
    title: 'Show Logs',
    run: () => actions.setLayout({ bottom: true, bottomTab: 'logs' }),
  },
  {
    id: 'show-preview',
    title: 'Show Game Preview',
    available: hasProject,
    run: () => actions.openTab({ id: 'preview', kind: 'preview', title: 'Game Preview' }),
  },
  { id: 'new-chat', title: 'AI: New Conversation', run: () => actions.newChat() },
  {
    id: 'close-project',
    title: 'Close Project',
    available: hasProject,
    run: () => actions.closeProject(),
  },
  { id: 'doctor', title: 'Run GameForge Doctor', run: () => actions.openSettings('doctor') },
];

/** Normalizes a keyboard event to the shortcut notation used above. */
export function shortcutOf(event: KeyboardEvent): string {
  const parts: string[] = [];
  if (event.ctrlKey || event.metaKey) parts.push('Ctrl');
  if (event.altKey) parts.push('Alt');
  if (event.shiftKey) parts.push('Shift');
  let key = event.key;
  if (key.length === 1) key = key.toUpperCase();
  if (key === ' ') key = 'Space';
  parts.push(key);
  return parts.join('+');
}

export function commandForShortcut(shortcut: string): Command | undefined {
  return COMMANDS.find((c) => c.shortcut === shortcut && (c.available?.() ?? true));
}

/** Simple fuzzy score: all query characters in order, bonus for word starts and contiguity. */
export function fuzzyScore(query: string, text: string): number {
  const q = query.toLowerCase().trim();
  if (!q) return 1;
  const t = text.toLowerCase();
  if (t.includes(q)) return 100 - t.indexOf(q);
  let score = 0;
  let last = -1;
  for (const ch of q) {
    const index = t.indexOf(ch, last + 1);
    if (index === -1) return 0;
    score += index === last + 1 ? 3 : 1;
    if (index === 0 || /[\s/_.-]/.test(t[index - 1]!)) score += 2;
    last = index;
  }
  return score;
}
