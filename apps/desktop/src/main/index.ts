import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { app, BrowserWindow, Menu, nativeTheme, session, shell } from 'electron';
import { Backend } from './backend';
import { registerIpc } from './ipc';

const here = path.dirname(fileURLToPath(import.meta.url));
const isDev = !app.isPackaged;
const isE2E = process.env.GAMEFORGE_E2E === '1';

app.setName('XyoLua GameForge');
if (isE2E && process.env.GAMEFORGE_USER_DATA)
  app.setPath('userData', process.env.GAMEFORGE_USER_DATA);
if (!isE2E && !app.requestSingleInstanceLock()) app.quit();

let mainWindow: BrowserWindow | null = null;

function templatesDir(): string {
  // Packaged: copied as extraResources. Dev: straight from the monorepo.
  return app.isPackaged
    ? path.join(process.resourcesPath, 'templates')
    : path.join(app.getAppPath(), '..', '..', 'packages', 'godot', 'templates');
}

const backend = new Backend({
  ...(process.env.GAMEFORGE_CONFIG_DIR ? { configDir: process.env.GAMEFORGE_CONFIG_DIR } : {}),
  templatesDir: templatesDir(),
  projectsDir:
    process.env.GAMEFORGE_PROJECTS_DIR ?? path.join(app.getPath('documents'), 'GameForge'),
  version: app.getVersion(),
  e2e: isE2E,
  send: (channel, payload) => {
    if (mainWindow && !mainWindow.isDestroyed())
      mainWindow.webContents.send(`event:${channel}`, payload);
  },
});

function createWindow(): void {
  nativeTheme.themeSource = 'dark';
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 640,
    show: false,
    backgroundColor: '#0e1013',
    title: 'XyoLua GameForge',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'hidden',
    ...(process.platform === 'darwin'
      ? {}
      : { titleBarOverlay: { color: '#0e1013', symbolColor: '#8a93a3', height: 36 } }),
    icon: path.join(here, '../../build/icon.png'),
    webPreferences: {
      preload: path.join(here, '../preload/index.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      spellcheck: false,
    },
  });
  mainWindow.once('ready-to-show', () => mainWindow?.show());

  // Never navigate away from the app; open https links in the system browser.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (event, url) => {
    const allowed =
      isDev &&
      process.env.ELECTRON_RENDERER_URL &&
      url.startsWith(process.env.ELECTRON_RENDERER_URL);
    if (!allowed) event.preventDefault();
  });

  if (isDev && process.env.ELECTRON_RENDERER_URL)
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  else void mainWindow.loadFile(path.join(here, '../renderer/index.html'));
}

app.on('web-contents-created', (_event, contents) => {
  contents.on('will-attach-webview', (event) => event.preventDefault());
});

app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});

app.whenReady().then(async () => {
  // Deny every permission request (camera, notifications, ...): the app needs none.
  session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) =>
    callback(false),
  );
  Menu.setApplicationMenu(
    process.platform === 'darwin'
      ? Menu.buildFromTemplate([{ role: 'appMenu' }, { role: 'editMenu' }, { role: 'windowMenu' }])
      : null,
  );
  await backend.init();
  registerIpc(backend, () => mainWindow);
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  void backend.dispose().finally(() => {
    if (process.platform !== 'darwin' || isE2E) app.quit();
  });
});
