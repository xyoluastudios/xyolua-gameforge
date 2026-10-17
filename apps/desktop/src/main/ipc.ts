import { dialog, ipcMain, shell, type BrowserWindow, type IpcMainInvokeEvent } from 'electron';
import { z } from 'zod';
import { GamePlanSchema, toUserError } from '@gameforge/core';
import type { InvokeChannel, InvokeMap, IpcResult } from '@shared/api';
import type { Backend } from './backend';

const str = z.string().max(100_000);
const path = z.string().min(1).max(4096);
const severities = z.array(z.enum(['critical', 'high', 'medium', 'low', 'info'])).optional();
const issue = z
  .object({
    id: z.string(),
    ruleId: z.string(),
    severity: z.enum(['critical', 'high', 'medium', 'low', 'info']),
  })
  .passthrough();
const fixPlan = z.object({
  items: z.array(
    z.object({ issue, strategy: z.enum(['auto', 'ai', 'manual']), description: z.string() }),
  ),
  aiAvailable: z.boolean(),
});

/** Argument schemas for every channel — the renderer is treated as untrusted input. */
const SCHEMAS: { [C in InvokeChannel]: z.ZodType } = {
  'app:info': z.tuple([]),
  'app:open-external': z.tuple([
    z
      .string()
      .url()
      .refine((u) => /^https:\/\//.test(u), 'Only https links can be opened'),
  ]),
  'settings:get': z.tuple([]),
  'settings:save': z.tuple([z.record(z.string(), z.unknown())]),
  'settings:set-key': z.tuple([z.enum(['anthropic', 'openai']), z.string().max(500).nullable()]),
  'settings:test-provider': z.tuple([]),
  'dialog:select-folder': z.tuple([z.string().max(200).optional()]),
  'dialog:select-godot': z.tuple([]),
  'engine:detect': z.tuple([]),
  'project:open': z.tuple([path]),
  'project:close': z.tuple([]),
  'project:current': z.tuple([]),
  'project:recent': z.tuple([]),
  'project:tree': z.tuple([]),
  'project:read-file': z.tuple([path]),
  'project:write-file': z.tuple([path, z.string().max(5_000_000)]),
  'ai:plan': z.tuple([
    z.string().min(1).max(10_000),
    GamePlanSchema.optional(),
    z.string().max(5000).optional(),
  ]),
  'ai:create': z.tuple([
    z.object({
      plan: GamePlanSchema,
      parentDir: path,
      folderName: z.string().max(100).optional(),
      initGit: z.boolean(),
    }),
  ]),
  'ai:chat': z.tuple([str.min(1)]),
  'ai:edit': z.tuple([
    path,
    str.min(1),
    z
      .object({ startLine: z.number().int(), endLine: z.number().int(), text: z.string() })
      .optional(),
  ]),
  'ai:cancel': z.tuple([]),
  'ai:reset-chat': z.tuple([]),
  'analysis:run': z.tuple([]),
  'analysis:fix-plan': z.tuple([
    z.object({ severities, issueIds: z.array(z.string()).optional() }),
  ]),
  'analysis:apply-fix-plan': z.tuple([fixPlan]),
  'analysis:validate': z.tuple([]),
  'changes:list': z.tuple([]),
  'changes:get': z.tuple([path]),
  'changes:apply': z.tuple([z.array(path).optional()]),
  'changes:discard': z.tuple([z.array(path).optional()]),
  'changes:revert-applied': z.tuple([]),
  'game:run': z.tuple([z.enum(['play', 'debug'])]),
  'game:stop': z.tuple([]),
  'game:status': z.tuple([]),
  'tests:run': z.tuple([]),
  'git:status': z.tuple([]),
  'git:diff': z.tuple([path.optional(), z.boolean().optional()]),
  'git:log': z.tuple([]),
  'git:branches': z.tuple([]),
  'git:init': z.tuple([]),
  'git:commit': z.tuple([z.string().min(1).max(5000)]),
  'git:create-branch': z.tuple([z.string().min(1).max(100)]),
  'git:checkout': z.tuple([z.string().min(1).max(100)]),
  'git:discard': z.tuple([z.array(path).min(1)]),
  'git:push': z.tuple([]),
  'terminal:run': z.tuple([z.string().min(1).max(2000)]),
  'logs:recent': z.tuple([]),
  'plugins:list': z.tuple([]),
  'plugins:set-enabled': z.tuple([z.string().min(1).max(100), z.boolean()]),
  'doctor:run': z.tuple([z.boolean()]),
  'confirm:respond': z.tuple([z.string().uuid(), z.enum(['once', 'project', 'deny'])]),
};

type Handler<C extends InvokeChannel> = (
  ...args: InvokeMap[C][0]
) => InvokeMap[C][1] | Promise<InvokeMap[C][1]>;

export function registerIpc(backend: Backend, getWindow: () => BrowserWindow | null): void {
  const handlers: { [C in InvokeChannel]: Handler<C> } = {
    'app:info': () => backend.info(),
    'app:open-external': async (url) => {
      await shell.openExternal(url);
    },
    'settings:get': () => backend.settings(),
    'settings:save': (patch) => backend.saveSettings(patch),
    'settings:set-key': (provider, key) => backend.setApiKey(provider, key),
    'settings:test-provider': () => backend.testProvider(),
    'dialog:select-folder': async (title) => {
      const window = getWindow();
      const options = {
        title: title ?? 'Select folder',
        properties: ['openDirectory', 'createDirectory'] as ('openDirectory' | 'createDirectory')[],
      };
      const result = window
        ? await dialog.showOpenDialog(window, options)
        : await dialog.showOpenDialog(options);
      return result.canceled ? null : (result.filePaths[0] ?? null);
    },
    'dialog:select-godot': async () => {
      const window = getWindow();
      const options = {
        title: 'Select the Godot executable',
        properties: ['openFile'] as 'openFile'[],
        filters: process.platform === 'win32' ? [{ name: 'Godot', extensions: ['exe'] }] : [],
      };
      const result = window
        ? await dialog.showOpenDialog(window, options)
        : await dialog.showOpenDialog(options);
      if (result.canceled || !result.filePaths[0]) return null;
      let selected = result.filePaths[0];
      // macOS: allow picking Godot.app directly.
      if (selected.endsWith('.app')) selected = `${selected}/Contents/MacOS/Godot`;
      backend.saveSettings({ godot: { executable: selected } });
      return selected;
    },
    'engine:detect': () => backend.detectEngine(),
    'project:open': (root) => backend.openProject(root),
    'project:close': () => backend.closeProject(),
    'project:current': () => backend.currentProject(),
    'project:recent': () => backend.recentProjects(),
    'project:tree': () => backend.tree(),
    'project:read-file': (file) => backend.readFile(file),
    'project:write-file': (file, content) => backend.writeFile(file, content),
    'ai:plan': (description, previous, feedback) => backend.plan(description, previous, feedback),
    'ai:create': (request) => backend.createGame(request),
    'ai:chat': (message) => backend.chat(message),
    'ai:edit': (file, instruction, selection) => backend.aiEdit(file, instruction, selection),
    'ai:cancel': () => backend.cancel(),
    'ai:reset-chat': () => backend.resetChat(),
    'analysis:run': () => backend.analyze(),
    'analysis:fix-plan': (filter) => backend.fixPlan(filter),
    'analysis:apply-fix-plan': (plan) => backend.applyFixPlan(plan),
    'analysis:validate': () => backend.validate(),
    'changes:list': () => backend.pendingChanges(),
    'changes:get': (file) => backend.getChange(file),
    'changes:apply': (paths) => backend.applyChanges(paths),
    'changes:discard': (paths) => backend.discardChanges(paths),
    'changes:revert-applied': () => backend.revertApplied(),
    'game:run': (mode) => backend.runGame(mode),
    'game:stop': () => backend.stopGame(),
    'game:status': () => backend.gameStatus(),
    'tests:run': () => backend.runTests(),
    'git:status': () => backend.gitStatus(),
    'git:diff': (file, staged) => backend.gitDiff(file, staged),
    'git:log': () => backend.gitLog(),
    'git:branches': () => backend.gitBranches(),
    'git:init': () => backend.gitInit(),
    'git:commit': (message) => backend.gitCommit(message),
    'git:create-branch': (name) => backend.gitCreateBranch(name),
    'git:checkout': (name) => backend.gitCheckout(name),
    'git:discard': (paths) => backend.gitDiscard(paths),
    'git:push': () => backend.gitPush(),
    'terminal:run': (command) => backend.terminal(command),
    'logs:recent': () => backend.logs(),
    'plugins:list': () => backend.plugins(),
    'plugins:set-enabled': (id, enabled) => backend.setPluginEnabled(id, enabled),
    'doctor:run': (online) => backend.doctor(online),
    'confirm:respond': (id, decision) => backend.respondConfirm(id, decision),
  };

  for (const channel of Object.keys(handlers) as InvokeChannel[]) {
    ipcMain.handle(
      channel,
      async (event: IpcMainInvokeEvent, ...args: unknown[]): Promise<IpcResult<unknown>> => {
        // Only our own window may call into the backend.
        if (event.sender !== getWindow()?.webContents) {
          return { ok: false, error: { code: 'PERMISSION_DENIED', message: 'Unknown sender.' } };
        }
        const parsed = SCHEMAS[channel].safeParse(args);
        if (!parsed.success) {
          backend.app.logger.warn(
            `Rejected IPC ${channel}: invalid arguments`,
            parsed.error.issues,
          );
          return {
            ok: false,
            error: {
              code: 'INVALID_INPUT',
              message: 'Invalid request.',
              reason: parsed.error.issues[0]?.message,
            },
          };
        }
        try {
          const handler = handlers[channel] as (...a: unknown[]) => unknown;
          return { ok: true, value: await handler(...(parsed.data as unknown[])) };
        } catch (error) {
          const userError = toUserError(error);
          if (userError.code === 'INTERNAL')
            backend.app.logger.error(`IPC ${channel} failed`, error);
          return { ok: false, error: userError };
        }
      },
    );
  }
}
