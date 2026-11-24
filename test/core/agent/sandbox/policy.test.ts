import Database from 'better-sqlite3';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  bridge: vi.fn(() => ({ url: 'http://127.0.0.1:9/', token: 'token', close() {} })),
  scopedCommand: vi.fn(),
  scopedFile: vi.fn(),
  mcpDefinitions:
    vi.fn<
      () => ReturnType<
        (typeof import('../../../../src/core/capabilities/mcp'))['mcpToolDefinitions']
      >
    >(),
}));

vi.mock('electron', () => ({ app: { getPath: () => '/tmp/delion-sandbox-policy' } }));
vi.mock('../../../../src/core/capabilities/skills', () => ({
  builtinSkillsDirectory: () => '/tmp/skills',
  ensureBuiltinSkills: () => {},
  effectiveDisabledSkills: () => new Set<string>(),
  globalSkillDirectories: () => ['/tmp/skills'],
  readDisabledSkillPaths: () => new Set<string>(),
}));
vi.mock('../../../../src/core/capabilities/mcp', () => ({
  mcpToolDefinitions: state.mcpDefinitions,
}));
vi.mock('../../../../src/core/capabilities/command-server', () => ({
  COMMAND_BRIDGE: 'delion() { :; }',
  startDomainBridge: () => state.bridge(),
}));
vi.mock('../../../../src/core/capabilities/tools', () => ({
  readDisabledTools: () => new Set<string>(),
}));
vi.mock('../../../../src/core/remote/helper', async (original) => ({
  ...(await original<typeof import('../../../../src/core/remote/helper')>()),
  helperSession: () => ({ scopedCommand: state.scopedCommand, scopedFile: state.scopedFile }),
}));

import { agentEnvironment } from '../../../../src/core/agent/environment';
import { launchPlan, scopedDirectories } from '../../../../src/core/agent/sandbox/mode';
import { referenceFilePath } from '../../../../src/modules/chat/main/reference-file';
import { fileLinkKey } from '../../../../src/modules/chat/view/reference-tokens';
import { hostPorts } from '../../../../src/core/ports';
import { provideTestHostPorts } from '../../host-mock';
import {
  chatShareDirectory,
  insertSession,
  row,
  writePermissionMode,
} from '../../../../src/core/agent/session/store';

const root = mkdtempSync(join(tmpdir(), 'delion-sandbox-policy-'));
const commandTools =
  process.platform === 'darwin' ||
  (process.platform === 'win32' && existsSync(join('.build', 'scopedfs', 'scopedfs.exe')))
    ? ['sandbox_command']
    : [];
let db: Database.Database;

function database(
  approveFileChange?: NonNullable<ReturnType<typeof hostPorts>['desktop']['approveFileChange']>,
) {
  state.mcpDefinitions.mockResolvedValue([]);
  db = new Database(':memory:');
  db.exec(`
    CREATE TABLE sessions (
      id TEXT PRIMARY KEY, project_id TEXT, cwd TEXT, file TEXT NOT NULL,
      title TEXT NOT NULL DEFAULT '新对话', title_temporary INTEGER NOT NULL DEFAULT 0,
      message_count INTEGER NOT NULL DEFAULT 0, archived INTEGER NOT NULL DEFAULT 0,
      pinned INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      provider_id TEXT, model TEXT, effort TEXT, parent_id TEXT
    );
    CREATE TABLE workspace_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE workspace_entries (
      id TEXT PRIMARY KEY, parent_id TEXT, name TEXT NOT NULL, kind TEXT NOT NULL,
      source_id TEXT, local_path TEXT, remote_id TEXT, updated_at TEXT NOT NULL
    );
  `);
  provideTestHostPorts({
    desktop: { ...hostPorts().desktop, approveFileChange },
    paths: {
      userData: () => join(root, 'user'),
      storage: () => join(root, 'storage'),
      home: () => join(root, 'home'),
      temp: () => join(root, 'tmp'),
      documents: () => root,
    },
    database: () => db,
    projects: {
      find: (id) => (id === 'p1' ? { name: '课题', path: join(root, 'project') } : null),
      local: () => [],
      remoteOf: () => null,
    },
  });
}

afterEach(() => {
  state.bridge.mockClear();
  state.scopedCommand.mockReset();
  state.scopedFile.mockReset();
  state.mcpDefinitions.mockReset();
  vi.unstubAllGlobals();
  db?.close();
});

describe('路径契约', () => {
  it('解析会话文件链接时保留虚拟根', () => {
    expect(fileLinkKey('/privacy/a.txt', '/data/chat-sessions/uuid', null, true)).toBe(
      '/privacy/a.txt',
    );
    expect(fileLinkKey('src/a.ts', '/data/chat-sessions/uuid', null, true)).toBe(
      '/data/chat-sessions/uuid/src/a.ts',
    );
  });
});

it('远程受限命令只转交获批后读取的项目文件副本', async () => {
  database();
  const approveSandboxCommand = vi
    .fn()
    .mockResolvedValueOnce({ approved: false })
    .mockResolvedValueOnce({ approved: true });
  const host = hostPorts();
  const target = { host: 'user@remote' };
  provideTestHostPorts({
    ...host,
    desktop: { ...host.desktop, approveSandboxCommand },
    projects: {
      ...host.projects,
      remoteOf: () => ({
        id: 'p1',
        label: 'remote',
        path: '/srv/project',
        remoteId: 'ssh',
        target,
      }),
    },
  });
  state.scopedFile.mockResolvedValue({ data: Buffer.from('staged').toString('base64') });
  state.scopedCommand.mockResolvedValue({ exitCode: 0, output: 'staged' });
  const id = insertSession('p1');
  writePermissionMode(id, 'approval');
  const { customTools } = await agentEnvironment().sessionOptions('p1', '/project', {
    askCards: false,
    sessionId: id,
  });
  const tool = customTools.find(({ name }) => name === 'sandbox_command')!;
  const params = { command: 'exec /bin/cat inputs/1', files: ['/project/note.txt'] };
  const execute = () => tool.execute('call', params, undefined, undefined, {} as never);
  expect(await execute()).toMatchObject({ isError: true });
  expect(state.scopedFile).not.toHaveBeenCalled();
  expect(state.scopedCommand).not.toHaveBeenCalled();
  expect(await execute()).toMatchObject({
    content: [{ text: JSON.stringify({ exitCode: 0, output: 'staged' }) }],
  });
  expect(approveSandboxCommand).toHaveBeenLastCalledWith(
    expect.objectContaining({
      ...params,
      remote: target.host,
      session: id,
      grant: { keys: ['command:/bin/cat'], label: '运行 /bin/cat 命令' },
    }),
  );
  expect(state.scopedFile).toHaveBeenCalledWith(
    '/srv/project',
    expect.objectContaining({ action: 'read', path: 'note.txt' }),
    expect.any(AbortSignal),
  );
  expect(state.scopedCommand).toHaveBeenCalledWith(
    params.command,
    [Buffer.from('staged')],
    expect.any(AbortSignal),
  );
});

it('请求批准提供联网和连接器，拒绝和取消均不调用连接器', async () => {
  database();
  const host = hostPorts();
  const approveToolAction = vi
    .fn()
    .mockResolvedValueOnce({ approved: false, note: '改用草稿' })
    .mockImplementationOnce(async () => {
      cancellation.abort();
      return { approved: true };
    })
    .mockResolvedValueOnce({ approved: true });
  const cancellation = new AbortController();
  provideTestHostPorts({ ...host, desktop: { ...host.desktop, approveToolAction } });
  const call = vi.fn().mockResolvedValue({
    ok: true,
    result: { text: 'done' },
    source: { name: 'Mailbox' },
    links: [],
  });
  state.mcpDefinitions.mockResolvedValue([
    {
      type: 'function',
      function: { name: 'mail_send', description: 'Send mail', parameters: { type: 'object' } },
      source: { name: 'Mailbox', domain: 'mail.example.test' },
      execute: call,
    },
  ]);
  const id = insertSession(null);
  writePermissionMode(id, 'approval');
  const { customTools } = await agentEnvironment().sessionOptions(null, '/privacy', {
    askCards: false,
    sessionId: id,
  });
  expect(customTools.map((tool) => tool.name)).toEqual(
    expect.arrayContaining(['download_file', 'web_search', 'web_fetch', 'mail_send', 'delion']),
  );
  expect(customTools.map((tool) => tool.name)).not.toContain('bash');
  const send = customTools.find(({ name }) => name === 'mail_send')!;
  const payload = { address: 'person@example.test', body: 'Hello' };
  const execute = (signal?: AbortSignal) =>
    send.execute('1', payload, signal, undefined, {} as never);
  expect(await execute()).toMatchObject({
    isError: true,
    content: [{ text: '操作未获批准或已取消。用户说明：改用草稿' }],
  });
  expect(await execute(cancellation.signal)).toMatchObject({ isError: true });
  expect(call).not.toHaveBeenCalled();
  expect(await execute()).toMatchObject({ content: [{ text: 'done' }] });
  expect(call).toHaveBeenCalledExactlyOnceWith(payload, expect.any(AbortSignal));
  expect(approveToolAction).toHaveBeenLastCalledWith(
    expect.objectContaining({
      session: id,
      fields: expect.arrayContaining([{ label: '连接器', value: 'Mailbox (mail.example.test)' }]),
    }),
  );
});

describe('受限普通对话', () => {
  it('默认受限，共享目录名不是会话 id，子会话共用父目录', async () => {
    database();
    const id = insertSession(null);
    const share = chatShareDirectory(id);
    expect(share.replaceAll('\\', '/')).toMatch(new RegExp(`/chat-share/${id}$`));
    const child = '22222222-2222-4222-8222-222222222222';
    db.prepare(
      'INSERT INTO sessions (id, cwd, file, parent_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(child, row(id).cwd, '', id, 'x', 'x');
    const parentPlan = launchPlan(row(id));
    const childPlan = launchPlan(row(child));
    const parentRoots = scopedDirectories(row(id));
    expect(parentPlan).toMatchObject({ mode: 'approval', piCwd: '/privacy' });
    expect(childPlan.piCwd).toBe('/privacy');
    expect(parentRoots[1]?.host).toBe(realpathSync(share));
    expect(scopedDirectories(row(child))).toEqual(parentRoots);
  });

  it('工具列表没有网络、MCP、会话读取和命令桥，提示词不含会话 id', async () => {
    database();
    const id = insertSession(null);
    writePermissionMode(id, 'read-only');
    const options = await agentEnvironment().sessionOptions(null, '/privacy', {
      askCards: false,
      sessionId: id,
    });
    const names = options.customTools.map((tool) => tool.name).sort();
    expect(names).toEqual(['find', 'grep', 'ls', 'read', ...commandTools]);
    expect(options.commandPrefix).toBeUndefined();
    const prompt = options.appendSystemPrompt.join('\n');
    expect(prompt).toContain('/privacy');
    expect(prompt).toContain('/share');
    expect(prompt).toContain('finished files in /share');
    expect(prompt).not.toContain(id);
    expect(prompt).not.toContain('DELION_COMMAND');
    expect(prompt).not.toContain(join(root, 'storage', 'chat-sessions'));
    expect(state.bridge).not.toHaveBeenCalled();
  });

  it('完全访问保留命令桥，项目默认可直接修改自己的文件', async () => {
    database();
    const id = insertSession(null);
    writePermissionMode(id, 'full');
    const full = await agentEnvironment().sessionOptions(null, row(id).cwd!, {
      askCards: false,
      sessionId: id,
    });
    expect(full.commandPrefix).toContain('DELION_COMMAND_TOKEN');
    expect(full.appendSystemPrompt.join('\n')).toContain(row(id).cwd!);
    db.prepare(
      `INSERT INTO workspace_entries (id, name, kind, local_path, updated_at) VALUES ('p1', '课题', 'project', ?, 'x')`,
    ).run(join(root, 'project'));
    mkdirSync(join(root, 'project'), { recursive: true });
    const projectId = insertSession('p1');
    expect(launchPlan(row(projectId)).mode).toBe('project-write');
    const writable = await agentEnvironment().sessionOptions('p1', '/project', {
      askCards: false,
      sessionId: projectId,
    });
    expect(writable.customTools.map((tool) => tool.name)).toEqual([
      'read',
      'ls',
      'find',
      'grep',
      'write',
      'edit',
      ...commandTools,
    ]);
    expect(scopedDirectories(row(projectId)).map(({ name }) => name)).toEqual(['/project']);
  });

  it('未获得用户批准时不写入共享目录', async () => {
    database();
    const id = insertSession(null);
    writePermissionMode(id, 'approval');
    const options = await agentEnvironment().sessionOptions(null, '/privacy', {
      askCards: false,
      sessionId: id,
    });
    const write = options.customTools.find((tool) => tool.name === 'write')!;
    const result = await write.execute(
      '1',
      { path: '/share/note.txt', content: 'hello' },
      undefined,
      undefined,
      {} as never,
    );
    expect(result).toMatchObject({ isError: true });
  });

  it.skipIf(commandTools.length === 0)(
    '原始二进制文件经批准下载至共享目录，模型只收到虚拟路径',
    async () => {
      database();
      const host = hostPorts();
      const data = Uint8Array.of(0x50, 0x4b, 0, 255, 129);
      const fetch = vi
        .fn()
        .mockResolvedValueOnce(
          new Response(null, {
            status: 302,
            headers: { location: 'https://files.example.test/object' },
          }),
        )
        .mockResolvedValueOnce(new Response(data));
      vi.stubGlobal('fetch', fetch);
      const approveToolAction = vi
        .fn()
        .mockResolvedValueOnce({ approved: false })
        .mockResolvedValueOnce({ approved: true })
        .mockResolvedValueOnce({ approved: true });
      provideTestHostPorts({
        ...host,
        desktop: { ...host.desktop, approveToolAction },
      });
      const id = insertSession(null);
      const { customTools, appendSystemPrompt } = await agentEnvironment().sessionOptions(
        null,
        '/privacy',
        { askCards: false, sessionId: id },
      );
      const download = customTools.find(({ name }) => name === 'download_file')!;
      const input = { url: 'https://drive.example.test/export', path: '/share/原件.docx' };
      const execute = (url = input.url) =>
        download.execute('1', { ...input, url }, undefined, undefined, {} as never);
      expect(await execute()).toMatchObject({ isError: true });
      expect(fetch).not.toHaveBeenCalled();
      const redirected = 'https://files.example.test/object';
      expect(await execute()).toMatchObject({
        content: [{ text: JSON.stringify({ redirect: redirected }) }],
      });
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(await execute(redirected)).toMatchObject({ content: [{ text: '/share/原件.docx' }] });
      expect(readFileSync(join(chatShareDirectory(id), '原件.docx'))).toEqual(Buffer.from(data));
      expect(appendSystemPrompt.join('\n')).not.toContain(chatShareDirectory(id));
    },
  );

  it.skipIf(commandTools.length === 0)('受限命令逐次审批，只接收当前会话的副本', async () => {
    database();
    const approveSandboxCommand = vi
      .fn()
      .mockResolvedValueOnce({ approved: false })
      .mockResolvedValueOnce({ approved: true });
    const host = hostPorts();
    provideTestHostPorts({ ...host, desktop: { ...host.desktop, approveSandboxCommand } });
    const id = insertSession(null);
    writePermissionMode(id, 'approval');
    writeFileSync(join(chatShareDirectory(id), 'input.txt'), 'approved input');
    const tools = (
      await agentEnvironment().sessionOptions(null, '/privacy', {
        askCards: false,
        sessionId: id,
      })
    ).customTools;
    const command = tools.find(({ name }) => name === 'sandbox_command')!;
    const params = {
      command: process.platform === 'win32' ? 'type inputs\\1' : 'exec /bin/cat inputs/1',
      files: ['/share/input.txt'],
    };
    const execute = () => command.execute('call', params, undefined, undefined, {} as never);
    expect(await execute()).toMatchObject({ isError: true });
    expect(await execute()).toMatchObject({
      content: [{ text: JSON.stringify({ exitCode: 0, output: 'approved input' }) }],
    });
    expect(approveSandboxCommand).toHaveBeenCalledTimes(2);
  });

  it.skipIf(
    !existsSync(
      join('.build', 'scopedfs', process.platform === 'win32' ? 'scopedfs.exe' : 'scopedfs'),
    ),
  )('每次单独批准写入，共享目录和私有目录分开', async () => {
    const approve = vi
      .fn()
      .mockResolvedValueOnce({ approved: true })
      .mockResolvedValueOnce({ approved: false });
    database(approve);
    const id = insertSession(null);
    writePermissionMode(id, 'approval');
    const tools = (
      await agentEnvironment().sessionOptions(null, '/privacy', {
        askCards: false,
        sessionId: id,
      })
    ).customTools;
    const write = tools.find(({ name }) => name === 'write')!;
    const read = tools.find(({ name }) => name === 'read')!;
    const run = (tool: typeof write, params: object) =>
      tool.execute('call', params, undefined, undefined, {} as never);
    expect(await run(write, { path: '/share/deliverable.txt', content: 'approved' })).toMatchObject(
      { content: [{ text: '/share/deliverable.txt' }] },
    );

    expect(
      await run(write, { path: '/share/deliverable.txt', content: 'overwrite' }),
    ).toMatchObject({ isError: true });
    expect(await run(write, { path: '/share/../other.txt', content: 'outside' })).toMatchObject({
      isError: true,
    });
    expect(await run(read, { path: '/share/deliverable.txt' })).toMatchObject({
      content: [{ text: 'approved' }],
    });
    expect(await run(read, { path: '/privacy/deliverable.txt' })).toMatchObject({ isError: true });
    expect(approve).toHaveBeenCalledTimes(2);
    expect(readFileSync(join(chatShareDirectory(id), 'deliverable.txt'), 'utf8')).toBe('approved');
  });

  it.skipIf(
    !existsSync(
      join('.build', 'scopedfs', process.platform === 'win32' ? 'scopedfs.exe' : 'scopedfs'),
    ),
  )('项目内修改可直接写入项目，无法访问普通聊天目录', async () => {
    const approve = vi.fn().mockResolvedValue({ approved: false });
    database(approve);
    const project = join(root, 'project');
    mkdirSync(project, { recursive: true });
    const id = insertSession('p1');
    writePermissionMode(id, 'project-write');
    const options = await agentEnvironment().sessionOptions('p1', '/project', {
      askCards: false,
      sessionId: id,
    });
    const write = options.customTools.find(({ name }) => name === 'write')!;
    const writeTo = (path: string) =>
      write.execute('call', { path, content: 'project' }, undefined, undefined, {} as never);
    expect(await writeTo('/project/code.txt')).toMatchObject({
      content: [{ text: '/project/code.txt' }],
    });
    expect(await writeTo('/share/code.txt')).toMatchObject({ isError: true });
    expect(await writeTo('/project/../outside.txt')).toMatchObject({ isError: true });
    expect(readFileSync(join(project, 'code.txt'), 'utf8')).toBe('project');
    expect(approve).not.toHaveBeenCalled();
  });

  it('主进程只能打开聊天目录内的链接目标', () => {
    database();
    const id = insertSession(null);
    mkdirSync(join(root, 'user'), { recursive: true });
    mkdirSync(join(root, 'home'), { recursive: true });
    const secret = join(root, 'user', 'delion.db');
    writeFileSync(secret, 'secret');
    const link = join(chatShareDirectory(id), 'outside');
    symlinkSync(join(root, 'user'), link, process.platform === 'win32' ? 'junction' : 'dir');
    const note = join(root, 'home', 'note.txt');
    writeFileSync(note, 'ext');
    expect(() => referenceFilePath(id, secret)).toThrow('路径超出聊天授权目录');
    expect(() => referenceFilePath(id, '/share/outside/delion.db')).toThrow('链接超出聊天授权目录');
    expect(() => referenceFilePath(id, '/privacy/../../etc/passwd')).toThrow(
      '路径超出聊天授权目录',
    );
    expect(() => referenceFilePath(id, note)).toThrow('路径超出聊天授权目录');
    const shared = join(chatShareDirectory(id), 'shared.txt');
    writeFileSync(shared, 'shared');
    expect(referenceFilePath(id, '/share/shared.txt')).toBe(realpathSync(shared));
  });
});
