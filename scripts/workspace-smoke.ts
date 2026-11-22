import { app, BrowserWindow, ipcMain, net } from 'electron';
import assert from 'node:assert/strict';
import {
  mkdtempSync,
  readFileSync,
  writeFileSync,
  existsSync,
  renameSync,
  truncateSync,
} from 'node:fs';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { provideHostPorts } from '../src/core/ports';
import { electronPorts } from '../src/app/main/host-electron';
import { closeDatabase, getDatabase } from '../src/app/main/database';
import {
  createWorkspaceEntry,
  getWorkspaceState,
  importWorkspaceFiles,
  readWorkspaceEntry,
  registerPreviewProtocol,
  registerPreviewScheme,
  saveWorkspaceNote,
  updateWorkspaceEntry,
  workspaceModule,
} from '../src/modules/workspace';
import { registerModuleIpc } from '../src/app/main/ipc';
import { chatModule } from '../src/modules/chat';
import { notificationsModule } from '../src/modules/notifications';
import { previewModule } from '../src/modules/preview';
import { remotesModule } from '../src/modules/remotes';
import { connectorsModule } from '../src/modules/connectors';
import { toolkit } from '../src/modules/connectors/contract';
import { settingsModule } from '../src/modules/settings';
import { updateModule } from '../src/modules/update';
import { registerAgentIpc } from '../src/app/main/agent-ipc';

const profile = mkdtempSync(join(tmpdir(), 'delion-workspace-test-'));
app.setPath('userData', profile);
registerPreviewScheme();
const pdf = new TextEncoder().encode('%PDF-1.4\nfixture');
globalThis.fetch = async (input) => {
  const url = new URL(String(input));
  assert.equal(url.href, 'https://models.example.com/api/v1/models');
  return Response.json({ data: [{ id: 'qwen' }, { id: 'minimax' }] });
};

app
  .whenReady()
  .then(async () => {
    const connectedApps = new Set<string>();
    provideHostPorts({
      ...electronPorts,
      network: {
        async fetch(url, init) {
          const path = new URL(url).pathname;
          if (!url.startsWith('https://backend.composio.dev/'))
            return electronPorts.network.fetch(url, init);
          if (path.endsWith('/toolkits/multi'))
            return Response.json({
              items: toolkit.options.map((slug) => ({
                slug,
                name: slug,
                meta: {
                  logo: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg'/%3E",
                },
              })),
            });
          if (
            path.endsWith('/tool_router/session') &&
            new Headers(init?.headers).get('x-api-key') === 'restricted-smoke-key'
          )
            return new Response(null, {
              status: 401,
              headers: { 'x-request-id': 'req_smoke401' },
            });
          if (path.endsWith('/tool_router/session'))
            return Response.json({ session_id: 'smoke', mcp: { url: 'https://example.com/mcp' } });
          if (path.endsWith('/session/smoke/link'))
            return Response.json({
              redirect_url: 'https://example.com/authorize',
              connected_account_id: 'gmail-smoke',
            });
          if (path.endsWith('/connected_accounts'))
            return Response.json({
              items: [
                ...[...connectedApps].map((slug) => ({
                  id: `${slug}-smoke`,
                  toolkit: { slug },
                  status: 'ACTIVE',
                })),
                { id: 'outlook-pending', toolkit: { slug: 'outlook' }, status: 'INITIATED' },
              ],
            });
          if (path.endsWith('/connected_accounts/gmail-smoke') && init?.method === 'DELETE') {
            connectedApps.delete('gmail');
            return new Response(null, { status: 204 });
          }
          throw new Error('Unexpected connector request ' + path);
        },
      },
    });
    const db = getDatabase();
    db.prepare("INSERT OR REPLACE INTO workspace_settings VALUES ('directory', ?)").run(
      join(profile, 'notes'),
    );
    const largePdfId = randomUUID();
    const largePdfPath = join(profile, 'large-fixture.pdf');
    const largePdfSize = 256 * 1024 * 1024;
    writeFileSync(largePdfPath, pdf);
    truncateSync(largePdfPath, largePdfSize);
    db.prepare(
      'INSERT INTO workspace_entries (id, name, kind, local_path, updated_at) VALUES (?, ?, ?, ?, ?)',
    ).run(largePdfId, 'large-fixture.pdf', 'file', largePdfPath, new Date().toISOString());
    const largePdf = await readWorkspaceEntry(largePdfId);
    assert.equal(largePdf.format, 'pdf');
    assert.equal(largePdf.bytes, undefined);
    registerPreviewProtocol();
    const largePreviewRange = await net.fetch(largePdf.previewUrl!, {
      headers: { Range: 'bytes=0-4' },
    });
    assert.equal(largePreviewRange.status, 206);
    assert.equal(largePreviewRange.headers.get('content-range'), `bytes 0-4/${largePdfSize}`);
    assert.equal(await largePreviewRange.text(), '%PDF-');

    const folder = createWorkspaceEntry({ name: '主题资料', kind: 'folder', parentId: null });
    const child = createWorkspaceEntry({ name: '参考', kind: 'folder', parentId: folder.id });
    const outsideFile = join(profile, '外部文件.txt');
    writeFileSync(outsideFile, '原文件');
    const [imported] = importWorkspaceFiles(child.id, [outsideFile]);
    assert.equal(readFileSync(outsideFile, 'utf8'), '原文件');
    assert.equal(
      readFileSync(join(profile, 'notes', 'workspace', '主题资料', '参考', '外部文件.txt'), 'utf8'),
      '原文件',
    );
    assert.equal((await readWorkspaceEntry(imported!.id)).text, '原文件');
    const promoted = updateWorkspaceEntry(folder.id, { kind: 'project' });
    assert.equal(
      getWorkspaceState().entries.find((entry) => entry.id === promoted.id)?.kind,
      'project',
    );
    assert.throws(() => updateWorkspaceEntry(folder.id, { parentId: child.id }), /子文件夹/);
    const note = createWorkspaceEntry({
      name: '笔记.md',
      kind: 'file',
      parentId: child.id,
      text: '# 初稿',
    });
    const other = createWorkspaceEntry({ name: '独立项目', kind: 'project', parentId: null });
    const opened = await readWorkspaceEntry(note.id);
    const revision = saveWorkspaceNote(note.id, '# 恢复测试', opened.revision!);
    let path = note.id;
    assert.equal(path, join(profile, 'notes', 'workspace', '主题资料', '参考', '笔记.md'));
    assert.throws(
      () => createWorkspaceEntry({ name: '笔记.md', kind: 'file', parentId: child.id }),
      /已存在/,
    );
    const duplicateNote = createWorkspaceEntry({
      name: '笔记 (2).md',
      kind: 'file',
      parentId: child.id,
      text: '独立副本',
    });
    assert.equal((await readWorkspaceEntry(duplicateNote.id)).text, '独立副本');
    assert(existsSync(join(profile, 'notes', 'workspace', '主题资料', '参考', '笔记 (2).md')));
    writeFileSync(path, '# 外部编辑');
    assert.throws(() => saveWorkspaceNote(note.id, '# 不覆盖', revision), /外部修改/);
    assert.equal(readFileSync(path, 'utf8'), '# 外部编辑');
    const disk = await readWorkspaceEntry(note.id);
    saveWorkspaceNote(note.id, '# 恢复测试', disk.revision!);
    const moved = updateWorkspaceEntry(note.id, { parentId: folder.id, name: '记录.md' });
    assert(!existsSync(path));
    path = join(profile, 'notes', 'workspace', '主题资料', '记录.md');
    assert.equal(readFileSync(path, 'utf8'), '# 恢复测试');
    updateWorkspaceEntry(child.id, { name: '参考改名', parentId: other.id });
    assert.equal(
      readFileSync(
        join(profile, 'notes', 'workspace', '独立项目', '参考改名', '笔记 (2).md'),
        'utf8',
      ),
      '独立副本',
    );
    const moveFrom = join(profile, 'notes', 'workspace', '独立项目', '参考改名');
    const moveTo = join(profile, 'notes', 'workspace', '独立项目', '恢复后的参考');
    db.prepare("INSERT OR REPLACE INTO workspace_settings VALUES ('storage-move', ?)").run(
      JSON.stringify({
        from: moveFrom,
        to: moveTo,
        id: child.id,
        name: '恢复后的参考',
        parentId: other.id,
        kind: 'folder',
      }),
    );
    renameSync(moveFrom, moveTo);
    closeDatabase();
    getWorkspaceState();
    assert(existsSync(join(moveTo, '笔记 (2).md')));
    assert.throws(
      () => createWorkspaceEntry({ name: '../CON', kind: 'file', parentId: folder.id }),
      /路径段/,
    );
    const odd = createWorkspaceEntry({
      name: 'CON',
      kind: 'file',
      parentId: folder.id,
      text: '安全路径',
    });
    assert.equal((await readWorkspaceEntry(odd.id)).text, '安全路径');
    assert(existsSync(join(profile, 'notes', 'workspace', '主题资料', '_CON')));
    renameSync(path, `${path}.external`);
    assert.throws(() => updateWorkspaceEntry(moved.id, { name: '不应生效.md' }));
    assert(!existsSync(join(dirname(path), '不应生效.md')));
    renameSync(`${path}.external`, path);
    createWorkspaceEntry({
      name: '未选资料',
      kind: 'file',
      parentId: other.id,
      text: '不应发送的资料',
    });

    registerAgentIpc();
    previewModule.register?.();
    workspaceModule.register?.();
    ipcMain.handle('window:get-state', () => ({ maximized: false }));
    registerModuleIpc([
      chatModule,
      workspaceModule,
      remotesModule,
      notificationsModule,
      settingsModule,
      connectorsModule,
      updateModule,
    ]);
    const win = new BrowserWindow({
      show: false,
      width: 1280,
      height: 800,
      webPreferences: {
        preload: join(process.cwd(), 'out/preload/index.cjs'),
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
      },
    });
    await win.loadFile(join(process.cwd(), 'out/renderer/index.html'), {
      query: { 'smoke-test': '1' },
    });
    const invoke = (body: string) =>
      win.webContents.executeJavaScript(`(async () => { ${body} })()`);
    const rendererRange = await invoke(`
      const response = await fetch(${JSON.stringify(largePdf.previewUrl)}, { headers: { Range: 'bytes=0-4' } });
      return { status: response.status, range: response.headers.get('content-range'), text: await response.text() };
    `);
    assert.equal(rendererRange.status, 206);
    assert.equal(rendererRange.text, '%PDF-');
    assert.match(rendererRange.range, /^bytes 0-4\//);
    const layout = {
      root: { type: 'group', id: 'g1', tabs: [`note:${moved.id}`], active: `note:${moved.id}` },
      focus: 'g1',
      maximized: null,
    };
    await invoke(
      `await window.delionBot.bridge.invoke('workspace:saveLayout', { projectId: ${JSON.stringify(promoted.id)}, layout: ${JSON.stringify(layout)} });`,
    );
    const provider = await invoke(
      `return await window.delionBot.bridge.invoke('llm:save', { name: '测试模型服务', baseUrl: 'https://models.example.com/api/v1', apiKey: 'test-model-key', models: ['qwen', 'deepseek-chat', 'minimax'] });`,
    );
    const providers = await invoke(`return await window.delionBot.bridge.invoke('llm:list');`);
    assert.equal(providers.length, 1);
    assert.equal(providers[0].enabled, true);
    assert.equal('apiKey' in providers[0], false);
    const verified = await invoke(
      `return await window.delionBot.bridge.invoke('llm:verify', { id: ${JSON.stringify(providers[0].id)}, baseUrl: ${JSON.stringify(providers[0].baseUrl)} });`,
    );
    assert.equal(verified.ok, true, verified.message);
    assert.deepEqual(verified.models, ['qwen', 'minimax']);
    await invoke(
      `await window.delionBot.bridge.invoke('llm:setEnabled', { id: ${JSON.stringify(provider.id)}, enabled: false });`,
    );
    assert.equal(
      (await invoke(`return await window.delionBot.bridge.invoke('llm:list');`))[0].enabled,
      false,
    );
    assert.equal(
      await invoke(`return await window.delionBot.bridge.invoke('connectors:configured');`),
      false,
    );
    await invoke(`await document.fonts.ready;`);
    assert.equal(
      await invoke(
        `for (let i = 0; i < 50 && !document.querySelector('aside[aria-label="主导航"]'); i++) await new Promise((r) => setTimeout(r, 100));
         return Boolean(document.querySelector('main') && document.querySelector('aside[aria-label="主导航"]'));`,
      ),
      true,
    );
    writeFileSync(
      join(process.cwd(), '.tools', 'agent-home.png'),
      (await win.webContents.capturePage()).toPNG(),
    );
    await invoke(
      `await window.delionBot.bridge.invoke('workspace:remove', ${JSON.stringify(moveTo)});`,
    );
    const connectorButton =
      "[...document.querySelectorAll('#main-nav button')].find((button) => button.querySelector('span')?.textContent === '连接器')";
    await invoke(`const link = ${connectorButton};
      const settings = link?.parentElement.querySelector('button[aria-label="设置"]');
      if (!settings || settings.offsetTop !== link.offsetTop || settings.offsetLeft >= link.offsetLeft) throw new Error('设置和连接器应在侧栏底部并排');
      if (link.querySelector('img')) throw new Error('未连接时侧栏不应显示应用图标');
      if (document.querySelector('nav[aria-label="功能入口"]').textContent.includes('连接器')) throw new Error('连接器出现在顶部功能入口');
      link.click();
      for (let i=0;i<50 && ![...document.querySelectorAll('#app-main button')].some(button => button.textContent?.trim() === '配置 Composio');i++) await new Promise(r=>setTimeout(r,100));
      const configure = [...document.querySelectorAll('#app-main button')].find(button => button.textContent?.trim() === '配置 Composio');
      if (!configure) throw new Error('缺少连接器配置按钮');
      configure.click();
      for (let i=0;i<50 && !document.querySelector('input[aria-label="Composio 项目密钥"]');i++) await new Promise(r=>setTimeout(r,100));
      if (!document.querySelector('input[aria-label="Composio 项目密钥"]')) throw new Error('缺少连接器配置入口');`);
    for (const width of [600, 900, 1280, 1920]) {
      win.setContentSize(width, 800);
      assert.equal(
        await invoke(`await new Promise(requestAnimationFrame);
        const pane=document.querySelector('input[aria-label="Composio 项目密钥"]').closest('[role="dialog"]');
        return pane.scrollWidth <= pane.clientWidth;`),
        true,
      );
    }
    win.webContents.setWindowOpenHandler(({ url }) => {
      assert.equal(url, 'https://example.com/authorize');
      connectedApps.add('gmail');
      return { action: 'deny' };
    });
    await invoke(`const submitKey=(key)=>{
        const input=document.querySelector('input[aria-label="Composio 项目密钥"]');
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,key);
        input.dispatchEvent(new Event('input',{bubbles:true}));
        const form=input.closest('form') ?? document.querySelector('[role="dialog"] form');
        if (!form) throw new Error('连接器配置表单不存在');
        form.requestSubmit();
      };
      submitKey('restricted-smoke-key');
      const dialog=document.querySelector('[role="dialog"]');
      for(let i=0;i<50 && !dialog.textContent.includes('req_smoke401');i++) await new Promise(r=>setTimeout(r,100));
      if(!dialog.textContent.includes('req_smoke401')) throw new Error('密钥错误未显示在输入框旁');
      if(!document.querySelector('input[aria-label="Composio 项目密钥"]')) throw new Error('错误后输入框消失: ' + dialog.innerHTML);
      submitKey('smoke-key');
      let row;
      for(let i=0;i<60 && !(row=document.querySelector('[role="group"][aria-label="gmail"]'));i++) await new Promise(r=>setTimeout(r,100));
      if(!row) throw new Error('配置后未显示应用目录');
      const icons=[...document.querySelectorAll('#app-main [role="group"] img')];
      if(icons.length===0) throw new Error('应用目录缺少图标');
      await Promise.all(icons.map(img=>img.decode()));
      for(let i=0;i<60 && row.querySelector('button')?.disabled !== false;i++) await new Promise(r=>setTimeout(r,100));
      const connect=row.querySelector('button');
      if(!connect || connect.disabled) throw new Error('Gmail 连接入口不可用');
      connect.click();
      for(let i=0;i<80;i++) {
        const accounts=await window.delionBot.bridge.invoke('connectors:accounts');
        if(accounts.some(item=>item.toolkit.slug==='gmail' && item.status==='ACTIVE')) break;
        await new Promise(r=>setTimeout(r,100));
      }
      [...document.querySelectorAll('#app-main button')].find(button=>button.textContent.trim()==='刷新账户')?.click();
      for(let i=0;i<80;i++) {
        row=document.querySelector('[role="group"][aria-label="gmail"]');
        if(row?.textContent.includes('管理')) break;
        await new Promise(r=>setTimeout(r,100));
      }
      if(!row?.textContent.includes('管理')) throw new Error('Gmail 授权后未显示账户');
      const sidebar = ${connectorButton};
      if (sidebar.querySelectorAll('img').length !== 1) throw new Error('侧栏应只显示已连接的 Gmail');`);
    connectedApps.add('googledrive').add('github');
    await invoke(`
      const sidebar = ${connectorButton};
      const refresh=()=>[...document.querySelectorAll('#app-main button')].find(button=>button.textContent.trim()==='刷新账户');
      for(let i=0;i<50 && !refresh();i++) await new Promise(r=>setTimeout(r,100));
      if(!refresh()) throw new Error('刷新账户入口不存在');
      refresh().click();
      for(let i=0;i<50 && sidebar.querySelectorAll('img').length!==3;i++) await new Promise(r=>setTimeout(r,100));
      if (sidebar.querySelectorAll('img').length !== 3) throw new Error('侧栏未更新已连接应用');`);
    connectedApps.add('googlecalendar').add('slack').add('notion');
    await invoke(`
      const sidebar = ${connectorButton};
      const refresh=()=>[...document.querySelectorAll('#app-main button')].find(button=>button.textContent.trim()==='刷新账户');
      for(let i=0;i<50 && !refresh();i++) await new Promise(r=>setTimeout(r,100));
      if(!refresh()) throw new Error('刷新账户入口不存在');
      refresh().click();
      const appNames = () => sidebar.querySelector('span[title]')?.title.split('、') ?? [];
      for(let i=0;i<50 && appNames().length!==6;i++) await new Promise(r=>setTimeout(r,100));
      if (appNames().length !== 6 || sidebar.querySelectorAll('img').length !== 3) throw new Error('侧栏最多显示三个图标，悬停时列出所有已连接应用');
      const row=document.querySelector('[role="group"][aria-label="gmail"]');
      const trigger=row.querySelector('button[aria-haspopup="menu"]');
      trigger.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,button:0,pointerType:'mouse'}));
      const disconnect = () => [...document.querySelectorAll('[role="menuitem"]')].find(item=>item.textContent.trim().startsWith('断开'));
      for(let i=0;i<50 && !disconnect();i++) await new Promise(r=>setTimeout(r,100));
      if(!disconnect()) throw new Error('断开账户菜单未出现');
      disconnect().click();
      const confirm = () => [...document.querySelectorAll('[role="alertdialog"] button, [role="dialog"] button')].find(button=>button.textContent.trim()==='断开账户');
      for(let i=0;i<50 && !confirm();i++) await new Promise(r=>setTimeout(r,100));
      if(!confirm()) throw new Error('断开账户确认框未出现');
      confirm().click();
      for(let i=0;i<50;i++) {
        const current=document.querySelector('[role="group"][aria-label="gmail"]');
        if(current && !current.textContent.includes('管理')) break;
        await new Promise(r=>setTimeout(r,100));
      }
      const current=document.querySelector('[role="group"][aria-label="gmail"]');
      if(current?.textContent.includes('管理') || appNames().includes('gmail') || sidebar.querySelectorAll('img').length !== 3) throw new Error('断开后应更新侧栏的已连接应用');`);
    assert.equal(connectedApps.has('gmail'), false);
    assert(existsSync(path));
    closeDatabase();
    assert.deepEqual(
      await invoke(
        `return await window.delionBot.bridge.invoke('workspace:layout', ${JSON.stringify(promoted.id)});`,
      ),
      layout,
    );
    assert.equal((await readWorkspaceEntry(moved.id)).text, '# 恢复测试');
    win.destroy();
    closeDatabase();
    console.log(
      'Workspace smoke passed: local PDF range reads, folder conversion/moves, note conflict protection, persistent workbench layout, model provider configuration and connector setup.',
    );
    app.quit();
  })
  .catch((error: unknown) => {
    console.error(error);
    closeDatabase();
    app.exit(1);
  });
