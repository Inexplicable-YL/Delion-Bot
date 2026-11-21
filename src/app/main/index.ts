import {
  app,
  autoUpdater as electronAutoUpdater,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  nativeImage,
  nativeTheme,
  shell,
  Tray,
} from 'electron';
import { join } from 'node:path';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { closeDatabase, getDatabase } from './database';
import { checkWorkspaceSender } from './window';
import type { TrayAction } from '../preload/api';
import {
  attachContextMenu,
  registerPreviewProtocol,
  registerPreviewScheme,
} from '../../modules/workspace';
import { closeAllTerminals, locateBash, prependRuntimePath } from '../../modules/terminal';
import { closeHelper } from '../../core/remote/helper';
import { preloadPi } from '../../core/agent/session/store';
import { closeAllPortTunnels, closeRemoteOpens } from '../../modules/remotes';
import { closeRemoteWatch } from '../../core/remote/watch';
import { registerSearchProvider } from '../../modules/search';
import { registerModuleIpc } from './ipc';
import { modules } from '../modules';
import {
  closeDomainBridge,
  gcChatMedia,
  hasLiveSessions,
  loadPi,
  registerAgentIpc,
  shutdownSessions,
} from './agent-ipc';
import { provideHostPorts } from '../../core/ports';
import { electronPorts } from './host-electron';
import {
  applyTheme,
  savedIcon,
  savedTheme,
  savedZoom,
  settingsSearch,
} from '../../modules/settings';

import Database from 'better-sqlite3';
import { spawn as spawnPty } from 'node-pty';

app.commandLine.appendSwitch('enable-smooth-scrolling');
app.commandLine.appendSwitch('lang', 'zh-CN');
registerPreviewScheme();

ipcMain.on('window:minimize', (event) => {
  BrowserWindow.fromWebContents(event.sender)?.minimize();
});

ipcMain.on('window:toggle-maximize', (event) => {
  const window = BrowserWindow.fromWebContents(event.sender);
  if (!window) return;
  if (window.isMaximized()) {
    window.unmaximize();
  } else {
    window.maximize();
  }
});

ipcMain.on('window:close', (event) => {
  BrowserWindow.fromWebContents(event.sender)?.close();
});

ipcMain.on('window:quit', (event) => {
  checkWorkspaceSender(event);
  quitApp();
});

ipcMain.handle('window:get-state', (event) => ({
  maximized: BrowserWindow.fromWebContents(event.sender)?.isMaximized() ?? false,
}));

ipcMain.on('window:content-ready', (event) => {
  if (event.sender === mainWindow?.webContents && event.senderFrame === event.sender.mainFrame)
    void preloadPi().catch(console.error);
});

const terminalSmokeTest = process.argv.includes('--terminal-smoke-test');
const smokeTest = process.argv.includes('--smoke-test') || terminalSmokeTest;
let startHidden = process.argv.includes('--hidden');
if (smokeTest && !terminalSmokeTest) {
  const profile = mkdtempSync(join(tmpdir(), 'delion-smoke-'));
  app.setPath('userData', profile);
  app.setPath('documents', profile);
  app.setPath('home', profile);
} else if (!terminalSmokeTest) {
  const profile = join(app.getPath('appData'), 'delion-bot');
  mkdirSync(profile, { recursive: true });
  app.setPath('userData', profile);
}
const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) app.quit();
let stopModules: (() => void)[] = [];
let tray: Tray | undefined;
let mainWindow: BrowserWindow | undefined;
let quitting = false;

function quitApp() {
  quitting = true;
  app.quit();
}

electronAutoUpdater.on('before-quit-for-update', () => {
  quitting = true;
});

app.on('second-instance', () => {
  if (mainWindow && !mainWindow.isDestroyed()) showMainWindow(mainWindow);
});
if (smokeTest) {
  setTimeout(
    () => {
      console.error('Smoke check timed out');
      app.exit(1);
    },
    terminalSmokeTest ? 60000 : 15000,
  ).unref();
}

app
  .whenReady()
  .then(() => {
    if (!hasSingleInstanceLock) return;
    provideHostPorts(electronPorts);
    if (process.platform === 'win32') app.setAppUserModelId('io.delionbot.desktop');
    if (process.platform === 'darwin') {
      const action = (value: TrayAction) => () => {
        if (!mainWindow || mainWindow.isDestroyed()) return;
        showMainWindow(mainWindow);
        mainWindow.webContents.send('window:tray-action', value);
      };
      Menu.setApplicationMenu(
        Menu.buildFromTemplate([
          {
            label: 'Delion Bot',
            submenu: [
              { role: 'about' },
              { label: '设置…', click: action('open-settings') },
              { type: 'separator' },
              { role: 'services' },
              { type: 'separator' },
              { role: 'hide' },
              { role: 'hideOthers' },
              { role: 'unhide' },
              { type: 'separator' },
              { role: 'quit' },
            ],
          },
          {
            label: '文件',
            submenu: [
              { label: '新建对话', click: action('new-chat') },
              { label: '新建项目', click: action('new-project') },
              { label: '关闭窗口', click: (_item, window) => window?.close() },
            ],
          },
          { role: 'editMenu', label: '编辑' },
          { label: '视图', submenu: [{ role: 'togglefullscreen' }] },
          { role: 'windowMenu', label: '窗口' },
        ]),
      );
      if (app.isPackaged && !smokeTest) startHidden ||= app.getLoginItemSettings().wasOpenedAtLogin;
    } else Menu.setApplicationMenu(null);
    getDatabase();
    prependRuntimePath();
    registerPreviewProtocol();
    applyTheme(savedTheme());
    if (process.platform === 'darwin') {
      app.dock?.setIcon(
        nativeImage.createFromPath(join(__dirname, 'icons', `DelionBot_${savedIcon()}_bg.png`)),
      );
    }
    registerAgentIpc();
    registerModuleIpc(modules);
    for (const module of modules) module.register?.();
    registerSearchProvider(settingsSearch);
    gcChatMedia();
    if (!smokeTest) {
      stopModules = modules.flatMap((module) => module.start?.() ?? []);
    }
  })
  .catch((error: unknown) => {
    console.error(error);
    if (!smokeTest) {
      dialog.showErrorBox(
        'Delion Bot 无法启动',
        error instanceof Error ? error.message : String(error),
      );
    }
    app.exit(1);
  });

function openExternalUrl(url: string): void {
  try {
    const external = new URL(url);
    if (external.protocol === 'https:' || external.protocol === 'http:') {
      void shell.openExternal(external.href);
    }
  } catch {}
}

async function createWindow(): Promise<void> {
  if (!hasSingleInstanceLock) return;
  if (mainWindow && !mainWindow.isDestroyed()) {
    showMainWindow(mainWindow);
    return;
  }
  const backgroundColor = () => (nativeTheme.shouldUseDarkColors ? '#121214' : '#f5f5f7');
  const window = new BrowserWindow({
    width: 1100,
    height: 760,
    minWidth: 600,
    minHeight: 600,
    show: !smokeTest && !startHidden,
    backgroundColor: backgroundColor(),
    icon: nativeImage.createFromPath(
      join(app.getAppPath(), 'assets', `DelionBot_${savedIcon()}_bg.png`),
    ),
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'hidden',
    titleBarOverlay: process.platform === 'darwin',
    webPreferences: {
      preload: join(__dirname, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      additionalArguments: [
        ...(app.isPackaged && process.argv.includes('--updated') ? ['--delion-updated'] : []),
      ],
    },
  });
  mainWindow = window;
  const updateBackground = () => window.setBackgroundColor(backgroundColor());
  nativeTheme.on('updated', updateBackground);
  attachContextMenu(window.webContents);
  window.on('closed', () => {
    nativeTheme.off('updated', updateBackground);
    mainWindow = undefined;
    closeAllTerminals();
  });
  window.on('close', (event) => {
    if (quitting) return;
    event.preventDefault();
    window.hide();
  });
  const openLink = (url: string) => {
    if (!modules.some((module) => module.openLink?.(url))) openExternalUrl(url);
  };
  window.webContents.setWindowOpenHandler(({ url }) => {
    openLink(url);
    return { action: 'deny' };
  });
  window.webContents.on('will-navigate', (event, url) => {
    event.preventDefault();
    openLink(url);
  });
  window.webContents.on('will-prevent-unload', (event) => {
    const wasQuitting = quitting;
    quitting = false;
    const choice = dialog.showMessageBoxSync(window, {
      type: 'warning',
      buttons: ['抛弃并退出', '继续编辑'],
      defaultId: 1,
      cancelId: 1,
      title: '仍有未保存的内容',
      message: '有未保存的笔记，确定抛弃并退出 Delion Bot 吗？',
    });
    if (choice === 0) {
      quitting = wasQuitting;
      event.preventDefault();
    }
  });
  const session = window.webContents.session;
  const allowClipboard = (_contents: unknown, permission: string) =>
    permission === 'clipboard-sanitized-write' || permission === 'clipboard-read';
  session.setPermissionRequestHandler((contents, permission, callback) =>
    callback(allowClipboard(contents, permission)),
  );
  session.setPermissionCheckHandler(allowClipboard);

  const sendWindowState = () => {
    window.webContents.send('window:state', { maximized: window.isMaximized() });
  };
  window.on('maximize', sendWindowState);
  window.on('unmaximize', sendWindowState);

  const devUrl = !app.isPackaged ? process.env.DELION_DEV_URL : undefined;
  if (devUrl) {
    if (new URL(devUrl).origin !== 'http://127.0.0.1:5173') {
      throw new Error('Unexpected development server origin');
    }
    await window.loadURL(smokeTest ? `${devUrl}?smoke-test=1` : devUrl);
  } else {
    await window.loadFile(
      join(__dirname, '../renderer/index.html'),
      smokeTest ? { query: { 'smoke-test': '1' } } : undefined,
    );
  }
  window.webContents.setZoomFactor(savedZoom());

  if (!smokeTest) createTray(window);

  if (smokeTest && !terminalSmokeTest) {
    for (const name of ['white', 'black']) {
      const iconPath = join(app.getAppPath(), 'assets', `DelionBot_${name}_bg.png`);
      if (nativeImage.createFromPath(iconPath).isEmpty()) {
        throw new Error(`Application icon failed to load: ${iconPath}`);
      }
    }
    const database = new Database(':memory:');
    try {
      database.exec('CREATE TABLE smoke (value TEXT NOT NULL)');
      database.prepare('INSERT INTO smoke VALUES (?)').run('ok');
      const row = database.prepare('SELECT value FROM smoke').get() as { value: string };
      if (row.value !== 'ok') throw new Error('SQLite smoke check failed');
      await new Promise((resolve) => setTimeout(resolve, 300));
      const rendered = await window.webContents.executeJavaScript(
        `document.querySelector('main') !== null && document.querySelector('aside[aria-label="主导航"]') !== null && window.delionBot?.version === ${JSON.stringify(app.getVersion())} && typeof window.delionBot?.bridge.invoke === 'function' && typeof window.require === 'undefined'`,
      );
      if (!rendered) throw new Error('Renderer or preload smoke check failed');
      const pi = await loadPi();
      if (typeof pi.createAgentSession !== 'function')
        throw new Error('Pi runtime smoke check failed');
      await new Promise<void>((resolve, reject) => {
        const pty = spawnPty(locateBash(), ['--noprofile', '--norc', '-c', 'echo DELION_PTY_OK'], {
          cols: 80,
          rows: 24,
          ...(process.platform === 'win32' ? { useConptyDll: true } : {}),
        });
        let output = '';
        pty.onData((data) => {
          output += data;
          if (output.includes('DELION_PTY_OK')) resolve();
        });
        pty.onExit(({ exitCode }) => {
          if (exitCode !== 0) reject(new Error(`PTY smoke check failed (${exitCode}): ${output}`));
        });
      });
      console.log(
        'Smoke check passed: SQLite, renderer, preload isolation, Agent runtime (ESM), Bash PTY.',
      );
    } finally {
      database.close();
    }
    app.quit();
  }
}

function showMainWindow(window: BrowserWindow): void {
  if (process.platform === 'darwin') app.show();
  if (window.isMinimized()) window.restore();
  window.show();
  window.focus();
}

function createTray(window: BrowserWindow): void {
  tray?.destroy();
  const icon = nativeImage
    .createFromPath(join(app.getAppPath(), 'assets', `DelionBot_${savedIcon()}_bg.png`))
    .resize({ width: 16, height: 16 });
  tray = new Tray(icon);
  tray.setToolTip('Delion Bot');
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: '打开主窗口', click: () => showMainWindow(window) },
      { type: 'separator' },
      {
        label: '新建对话',
        click: () => {
          showMainWindow(window);
          window.webContents.send('window:tray-action', 'new-chat');
        },
      },
      {
        label: '新建项目',
        click: () => {
          showMainWindow(window);
          window.webContents.send('window:tray-action', 'new-project');
        },
      },
      { type: 'separator' },
      {
        label: '退出',
        click: quitApp,
      },
    ]),
  );
  tray.on('click', () => showMainWindow(window));
}

app
  .whenReady()
  .then(createWindow)
  .catch((error: unknown) => {
    console.error(error);
    app.exit(1);
  });
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
let sessionsClosed = false;
app.on('before-quit', (event) => {
  quitting = true;
  if (!sessionsClosed && hasLiveSessions()) {
    event.preventDefault();
    sessionsClosed = true;
    void shutdownSessions(2000).finally(() => app.quit());
  }
});
app.on('will-quit', () => {
  closeDomainBridge();
  tray?.destroy();
  for (const stop of stopModules) stop();
  closeRemoteWatch();
  void closeHelper();
  closeAllPortTunnels();
  void closeRemoteOpens();
  closeDatabase();
});
app.on('activate', () => {
  void createWindow()
    .then(() => {
      if (mainWindow) showMainWindow(mainWindow);
    })
    .catch((error: unknown) => {
      console.error(error);
      app.exit(1);
    });
});
