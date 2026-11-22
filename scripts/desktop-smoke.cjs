const { app, BrowserWindow, dialog, Menu } = require('electron');
const { dirname, join, resolve } = require('node:path');
const { mkdtempSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { randomUUID } = require('node:crypto');
const assert = require('node:assert/strict');
const root = resolve(process.argv[2] || '.');
app.setAppPath(root);
const packaged = root.endsWith('.asar');
if (packaged) {
  Object.defineProperty(app, 'isPackaged', { value: true });
  process.resourcesPath = dirname(root);
}
const profile = mkdtempSync(join(tmpdir(), 'delion-desktop-smoke-'));
for (const name of ['userData', 'documents', 'home']) app.setPath(name, profile);
process.argv.push('--terminal-smoke-test');
app.setLoginItemSettings = () => {
  throw new Error('Smoke must not register login items');
};
let declined = 0;
let dockIcon;
if (process.platform === 'darwin') {
  const setIcon = app.dock.setIcon.bind(app.dock);
  app.dock.setIcon = (icon) => {
    dockIcon = icon;
    setIcon(icon);
  };
}
dialog.showMessageBoxSync = () => {
  declined++;
  return 1;
};

app.once('browser-window-created', (_event, window) => {
  window.webContents.setBackgroundThrottling(false);
  window.webContents.once('did-finish-load', () => {
    void run(window)
      .then(() => app.quit())
      .catch((error) => {
        console.error(error);
        app.exit(1);
      });
  });
});
require(join(root, 'out/main/index.cjs'));

async function run(window) {
  const js = (source) =>
    window.webContents.executeJavaScript(source).catch((error) => {
      console.error('Failed desktop fixture:', source);
      throw error;
    });
  const wait = async (predicate, label) => {
    const deadline = Date.now() + 10000;
    while (Date.now() < deadline) {
      if (await predicate()) return;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error(`Timed out: ${label}`);
  };
  await wait(() => js("!!document.querySelector('main')"), 'app mounted');
  assert.equal(await js('window.delionBot.platform'), process.platform);
  if (process.platform === 'darwin') {
    assert.ok(dockIcon && !dockIcon.isEmpty(), 'Dock icon must use generated macOS assets');
    assert.deepEqual(
      dockIcon.getSize(),
      { width: 1024, height: 1024 },
      'Dock icon must use generated macOS assets',
    );
    const bounds = window.getBounds();
    const zoom = window.webContents.getZoomFactor();
    const fontSize = await js('document.documentElement.style.fontSize');
    try {
      for (const width of [1100, 600]) {
        window.setSize(width, bounds.height);
        for (const [factor, font] of [
          [0.9, 12],
          [1, 16],
          [1.5, 20],
        ]) {
          window.webContents.setZoomFactor(factor);
          await js(`document.documentElement.style.fontSize = '${font}px'`);
          await wait(
            () => js(`Math.abs(innerWidth * ${factor} - ${width}) < 2`),
            'titlebar zoom and resize',
          );
          let layout;
          await wait(async () => {
            layout = await js(`(() => {
            const header = document.querySelector('header');
            return {
              overlay: navigator.windowControlsOverlay.getTitlebarAreaRect().toJSON(),
              visible: navigator.windowControlsOverlay.visible,
              header: header.getBoundingClientRect().toJSON(),
              paddingLeft: getComputedStyle(header).paddingLeft,
              drag: getComputedStyle(header).getPropertyValue('-webkit-app-region'),
              buttons: [...header.querySelectorAll('button')].map(button => ({
                label: button.getAttribute('aria-label'),
                rect: button.getBoundingClientRect().toJSON(),
                drag: getComputedStyle(button).getPropertyValue('-webkit-app-region'),
              })),
            };
            })()`);
            return (
              Math.abs(parseFloat(layout.paddingLeft) - layout.overlay.x) < 1 &&
              Math.abs(layout.header.height - layout.overlay.height) < 1
            );
          }, 'titlebar overlay and CSS geometry').catch((error) => {
            console.error('Titlebar geometry did not settle:', { width, factor, font, layout });
            throw error;
          });
          assert.equal(layout.visible, true);
          assert.ok(layout.overlay.x > 0 && layout.overlay.height > 0);
          assert.equal(layout.header.top, 0);
          assert.ok(Math.abs(layout.header.height - layout.overlay.height) < 1);
          assert.equal(layout.drag, 'drag');
          for (const { rect, drag } of layout.buttons) {
            assert.ok(
              rect.left >= layout.overlay.x - 1,
              `导航覆盖原生窗口按钮: ${JSON.stringify({ width, factor, font, layout })}`,
            );
            assert.ok(
              rect.top >= -1 && rect.bottom <= layout.header.bottom + 1,
              `导航超出标题栏: ${JSON.stringify({ width, factor, font, layout, button: { rect, drag } })}`,
            );
            assert.ok(rect.right <= layout.header.right + 1, '导航超出窗口');
            assert.equal(drag, 'no-drag');
          }
        }
      }
    } finally {
      window.setBounds(bounds);
      window.webContents.setZoomFactor(zoom);
      await js(`document.documentElement.style.fontSize = ${JSON.stringify(fontSize)}`);
    }
  }
  if (process.platform === 'darwin') {
    const update = await js("window.delionBot.bridge.invoke('update:state')");
    assert.equal(update.phase, packaged ? 'unsupported' : 'idle');
    if (!packaged) {
      const checked = await js("window.delionBot.bridge.invoke('update:check')");
      assert.equal(checked.phase, 'unsupported');
      assert.equal(checked.reason, 'not-packaged');
      assert.deepEqual(await js("window.delionBot.bridge.invoke('update:state')"), checked);
    }
    const workspace = await js("window.delionBot.bridge.invoke('workspace:state')");
    console.log(
      '[EXPECTED] macOS PPTX export must reject the request. Electron will log the IPC error; the assertion below checks it.',
    );
    const exportError = await js(
      "window.delionBot.bridge.invoke('workspace:exportOfficePdf', { type: 'workspace', id: '00000000-0000-4000-8000-000000000001' }).then(() => '', error => error.message)",
    );
    assert.match(exportError, /当前平台暂不支持 PPTX 转 PDF/);
    assert.deepEqual(await js("window.delionBot.bridge.invoke('workspace:state')"), workspace);
    console.log('[PASS] macOS PPTX export rejected as expected; workspace unchanged.');
    assert.equal(
      await js('document.querySelector(\'header button[aria-label="关闭"]\') === null'),
      true,
    );
    const menu = Menu.getApplicationMenu();
    assert.ok(menu);
    const items = menu.items.flatMap((item) => item.submenu?.items ?? []);
    assert.ok(items.some((item) => item.role === 'quit'));
    assert.ok(items.some((item) => item.role === 'copy'));
    assert.ok(items.some((item) => item.role === 'paste'));
    const close = items.find((item) => item.label === '关闭窗口');
    assert.ok(close);
    assert.ok(!close.accelerator);
    window.show();
    close.click(close, undefined, {});
    assert.equal(window.isVisible(), true);
    const popup = new BrowserWindow({
      parent: window,
      modal: true,
      show: false,
      webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false },
    });
    await popup.loadURL('data:text/html,<title>Login window fixture</title>');
    popup.show();
    close.click(close, popup, {});
    await wait(() => popup.isDestroyed(), 'menu closes focused auxiliary window');
    assert.equal(window.isDestroyed(), false);
    assert.equal(window.isVisible(), true);
    close.click(close, window, {});
    assert.equal(window.isDestroyed(), false);
    assert.equal(window.isVisible(), false);
    const settings = items.find((item) => item.label === '设置…');
    settings.click(settings, window, {});
    await wait(() => js("!!document.querySelector('[data-setting-id]')"), 'native settings action');
  } else assert.equal(Menu.getApplicationMenu(), null);

  const project = await js(
    "window.delionBot.bridge.invoke('workspace:create', { parentId: null, name: '生命周期测试', kind: 'project' })",
  );
  const id = randomUUID();
  await js(
    `window.delionBot.bridge.invoke('terminal:create', { projectId: '${project.id}', id: '${id}' })`,
  );
  const checkRuntime = async (marker) => {
    await js(
      `window.delionBot.bridge.invoke('terminal:write', { id: '${id}', data: ${JSON.stringify(`echo ${marker}\r`)} })`,
    );
    await wait(
      () =>
        js(
          `window.delionBot.bridge.invoke('terminal:list', '${project.id}').then(items => items.some(item => item.id === '${id}' && item.buffer.includes('${marker}\\r\\n') && item.exitCode === null))`,
        ),
      'live PTY',
    );
  };
  await checkRuntime('BEFORE_CLOSE');
  window.show();
  window.close();
  assert.equal(window.isDestroyed(), false);
  assert.equal(window.isVisible(), false);
  app.emit('activate', {}, false);
  await wait(() => window.isVisible(), 'Dock activation restores window');
  assert.equal(BrowserWindow.getAllWindows().length, 1);
  await checkRuntime('AFTER_REOPEN');

  await js('window.onbeforeunload = () => false; void 0');
  app.quit();
  await wait(() => declined === 1, 'cancel unsaved-note exit');
  await checkRuntime('AFTER_CANCEL');
  window.close();
  assert.equal(window.isVisible(), false);
  app.emit('activate', {}, false);
  await wait(() => window.isVisible(), 'reopen after cancelled exit');
  await js('window.onbeforeunload = null; void 0');

  console.log(
    'Desktop smoke passed: Mac titlebar safe area/zoom/font sizing, platform preload/menu, unsupported Mac conversion guard, focused-window close, close/reopen, cancelled note exit preserves live PTY; no login registration.',
  );
}
