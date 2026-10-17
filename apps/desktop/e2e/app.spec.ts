import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  _electron as electron,
  expect,
  test,
  type ElectronApplication,
  type Page,
} from '@playwright/test';

/**
 * End-to-end test of the real desktop app (built with `pnpm build`).
 * Uses the offline mock provider, so no API key is needed. When GODOT_PATH
 * points to Godot 4.3+, the generated game is also validated and tested.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.resolve(here, '..');
const screenshots = process.env.GAMEFORGE_SCREENSHOTS
  ? path.resolve(process.env.GAMEFORGE_SCREENSHOTS)
  : null;
const withGodot = !!process.env.GODOT_PATH;

// One app instance for the whole flow: later steps build on earlier ones.
test.describe.configure({ mode: 'serial' });

let app: ElectronApplication;
let page: Page;
let projectsDir: string;

async function shot(name: string) {
  if (!screenshots) return;
  mkdirSync(screenshots, { recursive: true });
  await page.screenshot({ path: path.join(screenshots, `${name}.png`) });
}

test.beforeAll(async () => {
  const base = mkdtempSync(path.join(os.tmpdir(), 'gf-e2e-'));
  projectsDir = path.join(base, 'projects');
  app = await electron.launch({
    args: [appDir],
    cwd: appDir,
    env: {
      ...process.env,
      GAMEFORGE_E2E: '1',
      GAMEFORGE_CONFIG_DIR: path.join(base, 'config'),
      GAMEFORGE_USER_DATA: path.join(base, 'user-data'),
      GAMEFORGE_PROJECTS_DIR: projectsDir,
      AI_PROVIDER: 'mock',
      ...(withGodot ? {} : { GODOT_PATH: '', PATH: process.env.PATH ?? '' }),
    },
  });
  page = await app.firstWindow();
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.waitForLoadState('domcontentloaded');
});

test.afterAll(async () => {
  await app?.close();
});

test('starts on the welcome screen with a working layout', async () => {
  await expect(page.getByTestId('welcome')).toBeVisible();
  await expect(page.getByTestId('sidebar')).toBeVisible();
  await expect(page.getByTestId('agent-panel')).toBeVisible();
  await expect(page.getByTestId('statusbar')).toContainText('Mock (offline, no AI)');
  await expect(page.getByTestId('agent-programmer')).toBeVisible();
  await shot('welcome');
});

test('command palette (Ctrl+K) lists commands and opens settings', async () => {
  await page.keyboard.press('Control+K');
  const palette = page.getByTestId('command-palette');
  await expect(palette).toBeVisible();
  await expect(palette).toContainText('Create Game');
  await expect(palette).toContainText('Open Project');
  await expect(page.getByTestId('command-palette').getByRole('textbox')).toBeFocused();
  await page.keyboard.type('settings');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('settings-dialog')).toBeVisible();
  await expect(page.getByTestId('provider-select')).toHaveValue('mock');
  await page.getByText('Privacy & Security').click();
  await expect(page.getByTestId('settings-dialog')).toContainText(
    'No analytics, no tracking, no telemetry',
  );
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('settings-dialog')).toBeHidden();
});

test('creates a game: describe → plan → approve → generated project', async () => {
  await page.getByTestId('welcome-create').click();
  await expect(page.getByTestId('create-dialog')).toBeVisible();
  await page
    .getByTestId('game-description')
    .fill(
      'Create a 3D horror game inside an abandoned hospital. Find keys, open doors and escape the monster.',
    );
  await page.getByTestId('parent-dir').fill(projectsDir);
  await shot('create-describe');
  await page.getByTestId('generate-plan').click();

  const plan = page.getByTestId('plan-view');
  await expect(plan).toBeVisible();
  await expect(plan).toContainText('Abandoned');
  await expect(plan).toContainText('Horror');
  await expect(plan).toContainText('Keys and doors');
  await expect(page.getByTestId('plan-approve')).toBeVisible();
  await expect(page.getByTestId('plan-edit')).toBeVisible();
  await expect(page.getByTestId('plan-regenerate')).toBeVisible();
  await expect(page.getByTestId('plan-cancel')).toBeVisible();
  await shot('plan-review');
  await page.getByTestId('plan-approve').click();

  const progress = page.getByTestId('generation-progress');
  await expect(progress).toBeVisible();
  if (withGodot) {
    // QA asks before running Godot (it executes the project scripts).
    const confirm = page.getByTestId('confirm-dialog');
    await expect(confirm).toBeVisible({ timeout: 60_000 });
    await expect(confirm).toContainText('QA wants to execute');
    await shot('confirmation');
    await page.getByTestId('confirm-project').click();
  }
  await expect(progress).toContainText('is ready', { timeout: 240_000 });
  await expect(progress).toContainText('Create project, scenes and scripts');
  if (withGodot) await expect(progress).toContainText(/Tests: 1\d\/1\d passed/);
  await shot('generation-done');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('create-dialog')).toBeHidden();

  // The project is open: explorer, preview, agents.
  await expect(page.getByTestId('preview-panel')).toBeVisible();
  await expect(page.getByTestId('file-project.godot')).toBeVisible();
});

test('opens a script in the code editor', async () => {
  await page.keyboard.press('Control+P');
  await expect(page.getByTestId('command-palette').getByRole('textbox')).toBeFocused();
  await page.keyboard.type('player.gd');
  await page.keyboard.press('Enter');
  const editor = page.getByTestId('file-view');
  await expect(editor).toBeVisible();
  await expect(editor.locator('.cm-content')).toContainText('extends CharacterBody3D');
  await expect(editor.locator('.cm-lineNumbers')).toBeVisible();
  await shot('editor');
});

test('analyzes the project with scores and no critical issues', async () => {
  await page.keyboard.press('Control+Shift+A');
  const view = page.getByTestId('analysis-view');
  await expect(view).toBeVisible();
  await expect(view).toContainText('Architecture');
  await expect(view).toContainText('Code Quality');
  await expect(view).toContainText('Issues found: 0');
  await shot('analysis');
});

test('chat runs built-in actions and explains the mock limits', async () => {
  await page.getByTestId('chat-input').fill('Make the monster faster');
  await page.getByTestId('chat-input').press('Enter');
  await expect(page.getByTestId('chat')).toContainText('offline mock provider is active', {
    timeout: 30_000,
  });
  await page.getByTestId('chat-input').fill('git status');
  await page.getByTestId('chat-input').press('Enter');
  await expect(page.getByTestId('chat')).toContainText('On branch main');
  await shot('chat');
});

test('runs the game and mirrors live frames into the preview', async () => {
  test.skip(!withGodot, 'Godot is not available (set GODOT_PATH)');
  await page.keyboard.press('F5');
  await expect(page.getByTestId('stop')).toBeEnabled({ timeout: 60_000 });
  await expect(page.getByTestId('preview-frame')).toBeVisible({ timeout: 90_000 });
  await shot('preview');
  await page.getByTestId('stop').click();
  await expect(page.getByTestId('play')).toBeEnabled({ timeout: 20_000 });
});

test('fix my game: analyze an existing project, review the diff, apply', async () => {
  // A small Godot project with Godot 3 leftovers and a missing main scene.
  const root = mkdtempSync(path.join(os.tmpdir(), 'gf-legacy-'));
  const write = (rel: string, content: string) => {
    mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    writeFileSync(path.join(root, rel), content);
  };
  write(
    'project.godot',
    'config_version=5\n\n[application]\n\nconfig/name="Old Port"\nconfig/features=PackedStringArray("4.3")\n',
  );
  write(
    'scenes/game.tscn',
    '[gd_scene format=3]\n\n[ext_resource type="Script" path="res://scripts/player.gd" id="1"]\n\n[node name="Player" type="CharacterBody2D"]\nscript = ExtResource("1")\n',
  );
  write(
    'scripts/player.gd',
    'extends KinematicBody2D\n\nexport var speed = 200\nonready var sprite = $Sprite\n\nfunc _physics_process(delta):\n\tvar v = Input.get_vector("left", "right", "up", "down")\n\tif Input.is_action_just_pressed("jump"):\n\t\tyield(get_tree(), "idle_frame")\n',
  );

  // Open it (the folder picker is native, so go through the same IPC call) and reload the UI.
  await page.evaluate((dir) => {
    const bridge = (
      globalThis as unknown as {
        gameforge: { invoke: (channel: string, arg: string) => Promise<unknown> };
      }
    ).gameforge;
    return bridge.invoke('project:open', dir);
  }, root);
  await page.reload();
  await expect(page.getByTestId('preview-panel')).toBeVisible();

  await page.keyboard.press('Control+Shift+A');
  const view = page.getByTestId('analysis-view');
  await expect(view).toContainText('Godot 3 "onready" syntax');
  await expect(view).toContainText('Undefined input action');
  await expect(view).toContainText('No main scene');
  await shot('analysis-issues');

  await page.getByTestId('fix-critical').click();
  await expect(page.getByTestId('fix-plan')).toContainText('quick fix');
  await page.getByTestId('apply-fix-plan').click();

  const changes = page.getByTestId('changes-view');
  await expect(changes).toBeVisible({ timeout: 30_000 });
  await expect(changes).toContainText('scripts/player.gd');
  await expect(page.getByTestId('diff-view')).toBeVisible();
  // Staged: nothing is written before the user applies.
  expect(readFileSync(path.join(root, 'scripts/player.gd'), 'utf8')).toContain('onready var');
  await shot('review-changes');

  await page.getByTestId('apply-all').click();
  await expect(changes).toContainText('Changes applied');
  const fixed = readFileSync(path.join(root, 'scripts/player.gd'), 'utf8');
  expect(fixed).toContain('extends CharacterBody2D');
  expect(fixed).toContain('@onready var sprite');
  expect(fixed).toContain('await get_tree().process_frame');
  expect(readFileSync(path.join(root, 'project.godot'), 'utf8')).toContain(
    'run/main_scene="res://scenes/game.tscn"',
  );
});
