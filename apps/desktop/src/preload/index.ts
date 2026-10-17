import { contextBridge, ipcRenderer } from 'electron';
import type { EventChannel, GameForgeBridge, InvokeChannel } from '@shared/api';

/**
 * The only bridge between the sandboxed renderer and the main process.
 * It exposes two functions and only allow-listed channels.
 */

// Kept in sync with INVOKE_CHANNELS / EVENT_CHANNELS in shared/api.ts (the
// preload is bundled separately and must not import runtime code from there).
const INVOKE = new Set<string>([
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
]);
const EVENTS = new Set<string>([
  'event',
  'confirm',
  'log',
  'preview',
  'game',
  'files-changed',
  'changes-updated',
]);

const bridge: GameForgeBridge = {
  invoke: (channel: InvokeChannel, ...args: unknown[]) => {
    if (!INVOKE.has(channel)) return Promise.reject(new Error(`Blocked channel: ${channel}`));
    return ipcRenderer.invoke(channel, ...args);
  },
  on: (channel: EventChannel, listener: (payload: never) => void) => {
    if (!EVENTS.has(channel)) throw new Error(`Blocked event: ${channel}`);
    const wrapped = (_event: Electron.IpcRendererEvent, ...args: unknown[]) =>
      listener(args[0] as never);
    ipcRenderer.on(`event:${channel}`, wrapped);
    return () => ipcRenderer.removeListener(`event:${channel}`, wrapped);
  },
} as GameForgeBridge;

contextBridge.exposeInMainWorld('gameforge', bridge);
