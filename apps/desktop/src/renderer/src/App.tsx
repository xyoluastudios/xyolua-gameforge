import { useEffect, useRef, type PointerEvent as ReactPointerEvent } from 'react';
import { call, on } from './api';
import {
  closeTab,
  detectEngine,
  handleEvent,
  openPalette,
  refreshChanges,
  refreshSettings,
  refreshTree,
  setLayout,
} from './actions';
import { commandForShortcut, shortcutOf } from './commands';
import { AgentPanel } from './components/AgentPanel';
import { BottomPanel } from './components/BottomPanel';
import { CommandPalette } from './components/CommandPalette';
import { CreateGameDialog } from './components/CreateGameDialog';
import { ConfirmDialog, GodotMissingDialog, Toasts } from './components/Dialogs';
import { SettingsDialog } from './components/SettingsDialog';
import { Sidebar } from './components/Sidebar';
import { StatusBar } from './components/StatusBar';
import { TitleBar } from './components/TitleBar';
import { Workspace } from './components/Workspace';
import { PREVIEW_TAB, store, useStore } from './store';

/** Drag handle that resizes a panel. */
function Resizer({
  direction,
  onResize,
}: {
  direction: 'vertical' | 'horizontal';
  onResize: (delta: number) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const start = (event: ReactPointerEvent) => {
    event.preventDefault();
    let last = direction === 'vertical' ? event.clientX : event.clientY;
    ref.current?.classList.add('dragging');
    const move = (e: PointerEvent) => {
      const position = direction === 'vertical' ? e.clientX : e.clientY;
      onResize(position - last);
      last = position;
    };
    const up = () => {
      ref.current?.classList.remove('dragging');
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  return (
    <div
      ref={ref}
      className={`resizer ${direction === 'horizontal' ? 'horizontal' : ''}`}
      onPointerDown={start}
      role="separator"
      aria-orientation={direction}
    />
  );
}

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

export function App() {
  const layout = useStore((s) => s.layout);

  // Bootstrap and backend events.
  useEffect(() => {
    void (async () => {
      const [info, project, recent] = await Promise.all([
        call('app:info'),
        call('project:current'),
        call('project:recent'),
      ]);
      store.set({ info, recent, logs: await call('logs:recent') });
      await refreshSettings();
      if (project) {
        store.set({ project, tabs: [PREVIEW_TAB], activeTab: PREVIEW_TAB.id });
        void refreshTree();
        void refreshChanges();
      }
      void detectEngine();
    })();
    const offs = [
      on('event', handleEvent),
      on('confirm', (request) => store.set((s) => ({ confirms: [...s.confirms, request] }))),
      on('log', (entry) => store.set((s) => ({ logs: [...s.logs, entry].slice(-2000) }))),
      on('preview', ({ dataUrl }) => store.set({ preview: dataUrl })),
      on('game', (game) => store.set((s) => ({ game, preview: game.running ? s.preview : null }))),
      on('files-changed', () => void refreshTree()),
      on('changes-updated', (changes) => store.set({ changes })),
    ];
    return () => offs.forEach((off) => off());
  }, []);

  // Global keyboard shortcuts.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const shortcut = shortcutOf(event);
      if (shortcut === 'Ctrl+K' || shortcut === 'Ctrl+Shift+P') {
        event.preventDefault();
        openPalette('commands');
        return;
      }
      if (shortcut === 'Ctrl+W') {
        event.preventDefault();
        const active = store.get().activeTab;
        if (active) closeTab(active);
        return;
      }
      // Let editors and inputs keep their own Ctrl+S, Ctrl+F, Ctrl+I, ...
      const target = event.target as HTMLElement | null;
      const inEditor = !!target?.closest('.cm-editor');
      if (
        inEditor &&
        ['Ctrl+S', 'Ctrl+F', 'Ctrl+H', 'Ctrl+I', 'Ctrl+Z', 'Ctrl+Shift+Z', 'Ctrl+A'].includes(
          shortcut,
        )
      )
        return;
      const command = commandForShortcut(shortcut);
      if (command) {
        event.preventDefault();
        void command.run();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="app">
      <TitleBar />
      <div className="column" style={{ minHeight: 0 }}>
        <div className="main" style={{ flex: 1, minHeight: 0 }}>
          {layout.sidebar && (
            <>
              <div
                style={{ width: layout.sidebarWidth, flexShrink: 0, display: 'flex', minHeight: 0 }}
              >
                <Sidebar />
              </div>
              <Resizer
                direction="vertical"
                onResize={(d) =>
                  setLayout({ sidebarWidth: clamp(store.get().layout.sidebarWidth + d, 180, 520) })
                }
              />
            </>
          )}
          <div className="column center">
            <Workspace />
            {layout.bottom && (
              <>
                <Resizer
                  direction="horizontal"
                  onResize={(d) =>
                    setLayout({
                      bottomHeight: clamp(store.get().layout.bottomHeight - d, 120, 600),
                    })
                  }
                />
                <div style={{ height: layout.bottomHeight, flexShrink: 0, minHeight: 0 }}>
                  <BottomPanel />
                </div>
              </>
            )}
          </div>
          {layout.ai && (
            <>
              <Resizer
                direction="vertical"
                onResize={(d) =>
                  setLayout({ aiWidth: clamp(store.get().layout.aiWidth - d, 300, 680) })
                }
              />
              <div style={{ width: layout.aiWidth, flexShrink: 0, display: 'flex', minHeight: 0 }}>
                <AgentPanel />
              </div>
            </>
          )}
        </div>
      </div>
      <StatusBar />
      <CommandPalette />
      <CreateGameDialog />
      <SettingsDialog />
      <GodotMissingDialog />
      <ConfirmDialog />
      <Toasts />
    </div>
  );
}
