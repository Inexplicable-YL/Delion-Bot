import Database from 'better-sqlite3';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
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
  remoteExec: vi.fn(),
  writeRemoteFile: vi.fn(),
  disabledTools: vi.fn(() => new Set<string>()),
  globalSkills: [] as { name: string; description: string; enabled: boolean; path: string }[],
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
  listGlobalSkills: () => state.globalSkills,
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
  readDisabledTools: state.disabledTools,
  setBuiltinCapabilities: () => {},
}));
vi.mock('../../../../src/core/remote/helper', async (original) => ({
  ...(await original<typeof import('../../../../src/core/remote/helper')>()),
  helperSession: () => ({
    scopedCommand: state.scopedCommand,
    scopedFile: state.scopedFile,
    exec: state.remoteExec,
    writeFile: state.writeRemoteFile,
  }),
}));

import { agentEnvironment } from '../../../../src/core/agent/environment';
import * as publicWeb from '../../../../src/core/capabilities/public-web-fetch';
import { saveWebSearchEntry } from '../../../../src/core/capabilities/web-search';
import { launchPlan, scopedDirectories } from '../../../../src/core/agent/sandbox/mode';
import { referenceFilePath } from '../../../../src/modules/chat/main/reference-file';
import { fileLinkKey } from '../../../../src/modules/chat/view/reference-tokens';
import { hostPorts } from '../../../../src/core/ports';
import { provideTestHostPorts } from '../../host-mock';
import {
  chatSessionDirectory,
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
  state.remoteExec.mockReset();
  state.writeRemoteFile.mockReset();
  state.mcpDefinitions.mockReset();
  state.disabledTools.mockReset();
  vi.restoreAllMocks();
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

it('远程命令获批后以 SSH 账户权限运行并接收项目文件副本', async () => {
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
  const scratch = '/tmp/delion-command.a1B2c3D4e5';
  state.remoteExec.mockImplementation(async (command, { onData }) => {
    if (command.startsWith('mktemp')) onData(Buffer.from(scratch + '\n'));
    if (command === 'exec /bin/cat inputs/1') onData(Buffer.from('staged'));
    return { code: 0, state: 'exited', lost: 0 };
  });
  const id = insertSession('p1');
  writePermissionMode(id, 'approval');
  const { customTools } = await agentEnvironment().sessionOptions('p1', '/project', {
    sessionId: id,
  });
  state.scopedFile.mockClear();
  const tool = customTools.find(({ name }) => name === 'sandbox_command')!;
  const params = { command: 'exec /bin/cat inputs/1', files: ['/project/note.txt'] };
  const execute = () => tool.execute('call', params, undefined, undefined, {} as never);
  expect(await execute()).toMatchObject({ isError: true });
  expect(state.scopedFile).not.toHaveBeenCalled();
  expect(state.remoteExec).not.toHaveBeenCalled();
  expect(await execute()).toMatchObject({
    content: [{ text: JSON.stringify({ exitCode: 0, output: 'staged' }) }],
  });
  expect(approveSandboxCommand).toHaveBeenLastCalledWith({
    ...params,
    remote: target.host,
    session: id,
    signal: expect.any(AbortSignal),
    grant: { keys: ['host-command:/bin/cat'], label: '运行 /bin/cat 命令' },
  });
  expect(state.scopedFile).toHaveBeenCalledWith(
    '/srv/project',
    expect.objectContaining({ action: 'read', path: 'note.txt' }),
    expect.any(AbortSignal),
  );
  expect(state.writeRemoteFile).toHaveBeenCalledWith(`${scratch}/inputs/1`, Buffer.from('staged'));
  expect(state.remoteExec).toHaveBeenCalledWith(
    params.command,
    expect.objectContaining({ cwd: scratch, signal: expect.any(AbortSignal) }),
  );
  expect(state.scopedCommand).not.toHaveBeenCalled();
});

it.each(['auto-approval', 'read-only'] as const)('%s 直接运行只读命令并拦截写入', async (mode) => {
  database();
  const approveSandboxCommand = vi.fn().mockResolvedValue({ approved: false });
  const host = hostPorts();
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
        target: { host: 'user@remote' },
      }),
    },
  });
  state.remoteExec.mockImplementation(async (_command, { onData }) => {
    onData(Buffer.from('src/a.ts:1:TODO'));
    return { code: 0, state: 'exited', lost: 0 };
  });
  state.scopedFile.mockResolvedValue({
    matches: [{ path: 'src/a.ts', line: 1, text: 'TODO' }],
    limited: true,
    skippedFiles: 1,
  });
  const id = insertSession('p1');
  writePermissionMode(id, mode);
  const { customTools, appendSystemPrompt } = await agentEnvironment().sessionOptions(
    'p1',
    '/project',
    {
      sessionId: id,
    },
  );
  const prompt = appendSystemPrompt.join('\n');
  state.scopedFile.mockClear();
  expect(prompt).toContain('the SSH project host (Linux)');
  expect(prompt).toContain('Virtual working directory: /project');
  expect(prompt).toContain('git status --short');
  expect(prompt).not.toContain('/srv/project');
  expect(prompt).not.toContain('user@remote');
  const tool = customTools.find(({ name }) => name === 'sandbox_command')!;
  const execute = (command: string) =>
    tool.execute('call', { command }, undefined, undefined, {} as never);
  expect(await execute('grep -rn TODO /project/src | head -n 5')).toMatchObject({
    content: [
      {
        text: expect.stringContaining('"searchLimited":true,"skippedFiles":1'),
      },
    ],
  });
  expect(await execute('git log --oneline -5')).toMatchObject({
    content: [{ text: JSON.stringify({ exitCode: 0, output: 'src/a.ts:1:TODO' }) }],
  });
  expect(await execute('gh pr checks 123 | grep -F TODO | head -n 5')).toMatchObject({
    content: [{ text: JSON.stringify({ exitCode: 0, output: 'src/a.ts:1:TODO' }) }],
  });
  expect(approveSandboxCommand).not.toHaveBeenCalled();
  expect(await execute('gh pr merge 123')).toMatchObject({ isError: true });
  expect(await execute('git push')).toMatchObject({ isError: true });
  expect(await execute('git diff --output=report.txt')).toMatchObject({ isError: true });
  if (mode === 'auto-approval') {
    expect(approveSandboxCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        grant: { keys: ['host-command:gh pr merge'], label: '运行 gh pr merge 命令' },
      }),
    );
    expect(approveSandboxCommand).toHaveBeenCalledTimes(3);
  } else {
    expect(approveSandboxCommand).not.toHaveBeenCalled();
  }
  expect(state.remoteExec).toHaveBeenCalledTimes(2);
  expect(state.scopedFile).toHaveBeenCalledExactlyOnceWith(
    '/srv/project',
    expect.objectContaining({ action: 'grep', path: 'src' }),
    expect.any(AbortSignal),
  );
});

it('curl HEAD 重定向到非公开地址前再次检查权限', async () => {
  database();
  const host = hostPorts();
  const approveToolAction = vi
    .fn()
    .mockResolvedValueOnce({ approved: true })
    .mockResolvedValueOnce({ approved: false });
  const approveSandboxCommand = vi.fn();
  provideTestHostPorts({
    ...host,
    desktop: { ...host.desktop, approveToolAction, approveSandboxCommand },
  });
  const fetch = vi
    .fn()
    .mockResolvedValue(
      new Response(null, { status: 302, headers: { location: 'http://127.0.0.2/private' } }),
    );
  vi.stubGlobal('fetch', fetch);
  const id = insertSession(null);
  const { customTools } = await agentEnvironment().sessionOptions(null, '/privacy', {
    sessionId: id,
  });
  const tool = customTools.find(({ name }) => name === 'sandbox_command')!;
  const result = await tool.execute(
    'call',
    { command: 'curl -sIL https://127.0.0.1/' },
    undefined,
    undefined,
    {} as never,
  );
  expect(result).toMatchObject({ isError: true });
  expect(fetch).toHaveBeenCalledExactlyOnceWith(
    expect.any(URL),
    expect.objectContaining({ method: 'HEAD', redirect: 'manual' }),
  );
  expect(approveToolAction).toHaveBeenCalledTimes(2);
  expect(approveSandboxCommand).not.toHaveBeenCalled();
});

it.each(['read-only', 'auto-approval', 'approval'] as const)(
  '%s 对 HTTP 读取、下载和写入应用同一解析结果',
  async (mode) => {
    database();
    const host = hostPorts();
    const approveSandboxCommand = vi.fn().mockResolvedValue({ approved: false });
    provideTestHostPorts({ ...host, desktop: { ...host.desktop, approveSandboxCommand } });
    const fetch = vi
      .spyOn(publicWeb, 'fetchPublicWebPage')
      .mockImplementation(
        async () => new Response('response\n', { headers: { 'content-type': 'text/plain' } }),
      );
    const id = insertSession(null);
    writePermissionMode(id, mode);
    const { customTools } = await agentEnvironment().sessionOptions(null, '/privacy', {
      sessionId: id,
    });
    const tool = customTools.find(({ name }) => name === 'sandbox_command')!;
    const execute = (command: string) =>
      tool.execute('call', { command }, undefined, undefined, {} as never);

    const get =
      'curl -fsSG --data-urlencode "q=two words" https://example.test/api -w "%{http_code}" | head -n2';
    if (mode === 'approval') approveSandboxCommand.mockResolvedValueOnce({ approved: true });
    expect(await execute(get)).toMatchObject({
      content: [{ text: JSON.stringify({ exitCode: 0, output: 'response\n200' }) }],
    });
    expect(fetch).toHaveBeenLastCalledWith(
      new URL('https://example.test/api?q=two+words'),
      expect.objectContaining({ method: 'GET', credentials: 'omit' }),
      expect.any(Function),
    );
    expect(approveSandboxCommand).toHaveBeenCalledTimes(mode === 'approval' ? 1 : 0);

    const post = 'curl -X POST --data "name=one" https://example.test/api';
    expect(await execute(post)).toMatchObject({ isError: true });
    expect(fetch).toHaveBeenCalledTimes(1);
    if (mode === 'read-only') {
      expect(await execute('curl -o /share/report.bin https://example.test/report')).toMatchObject({
        isError: true,
      });
      expect(approveSandboxCommand).not.toHaveBeenCalled();
      fetch.mockResolvedValueOnce(new Response('response\n'.repeat(16_000)));
      const large = await execute('curl -fsS https://example.test/api');
      const [response] = large.content;
      if (response?.type !== 'text') throw new Error('Expected a text command result');
      expect(JSON.parse(response.text)).toMatchObject({
        exitCode: 0,
        full_output_path: expect.stringMatching(/^\/command-output\//),
      });
      return;
    }

    expect(approveSandboxCommand).toHaveBeenLastCalledWith(
      expect.objectContaining({
        grant: { keys: [expect.stringContaining('http-write')], label: expect.any(String) },
      }),
    );
    approveSandboxCommand.mockResolvedValueOnce({ approved: true });
    expect(await execute(post)).toMatchObject({
      content: [{ text: JSON.stringify({ exitCode: 0, output: 'response\n' }) }],
    });
    expect(fetch).toHaveBeenLastCalledWith(
      new URL('https://example.test/api'),
      expect.objectContaining({ method: 'POST', body: 'name=one', redirect: 'manual' }),
      expect.any(Function),
    );
  },
);

it
  .skipIf(
    !existsSync(
      join('.build', 'scopedfs', process.platform === 'win32' ? 'scopedfs.exe' : 'scopedfs'),
    ),
  )
  .each(['read-only', 'approval', 'auto-approval'] as const)(
  '%s 解析相同的搜索和管道并按权限执行',
  async (mode) => {
    database();
    const host = hostPorts();
    const approveSandboxCommand = vi.fn().mockResolvedValue({ approved: false });
    provideTestHostPorts({ ...host, desktop: { ...host.desktop, approveSandboxCommand } });
    const id = insertSession(null);
    writePermissionMode(id, mode);
    const share = chatShareDirectory(id);
    const privacy = chatSessionDirectory(id);
    writeFileSync(join(share, 'a.ts'), 'TODO\n');
    writeFileSync(join(share, 'b.md'), 'TODO\n');
    writeFileSync(join(share, 'manifest.json'), '{"name":"demo"}');
    const bytes = Buffer.from([0, 1, 255, 128]);
    writeFileSync(join(share, 'sample.bin'), bytes);
    const { customTools } = await agentEnvironment().sessionOptions(null, '/privacy', {
      sessionId: id,
    });
    const tool = customTools.find(({ name }) => name === 'sandbox_command')!;
    const run = (command: string) =>
      tool.execute('call', { command }, undefined, undefined, {} as never);
    const runWithPermission = (command: string) => {
      if (mode === 'approval') approveSandboxCommand.mockResolvedValueOnce({ approved: true });
      return run(command);
    };
    const output = (value: string) => ({
      content: [{ text: JSON.stringify({ exitCode: 0, output: value }) }],
    });
    const search = 'rg -ni -g "*.ts" todo /share | head -n 1';
    if (mode === 'approval') await expect(run(search)).resolves.toMatchObject({ isError: true });
    await expect(runWithPermission(search)).resolves.toMatchObject(output('a.ts:1:TODO\n'));
    await expect(runWithPermission('rg --files -g "*.ts" /share | wc -l')).resolves.toMatchObject(
      output('1\n'),
    );
    const manifest =
      process.platform === 'win32'
        ? 'Get-Content -LiteralPath /share/manifest.json'
        : '/bin/cat /share/manifest.json';
    await expect(runWithPermission(`${manifest} | jq -r .name`)).resolves.toMatchObject(
      output('demo\n'),
    );
    const copy = 'cp /share/sample.bin /privacy/copy.bin';
    if (mode !== 'auto-approval') {
      await expect(run(copy)).resolves.toMatchObject({ isError: true });
      expect(existsSync(join(privacy, 'copy.bin'))).toBe(false);
    }
    if (mode !== 'read-only') {
      await expect(runWithPermission(copy)).resolves.toMatchObject(output(''));
      expect(readFileSync(join(privacy, 'copy.bin'))).toEqual(bytes);
    }
    if (mode === 'auto-approval') {
      vi.spyOn(publicWeb, 'fetchPublicWebPage').mockImplementation(async () => new Response(bytes));
      await expect(
        run('curl -fsSL -o /share/result.bin https://example.test/file && wc -c /share/result.bin'),
      ).resolves.toMatchObject(output('4\n'));
      expect(readFileSync(join(share, 'result.bin'))).toEqual(bytes);
    }
    expect(approveSandboxCommand).toHaveBeenCalledTimes(mode === 'approval' ? 6 : 0);
    await expect(run('rg --pre cat TODO /share')).resolves.toMatchObject({ isError: true });
    await expect(run('cat /share/a.ts | tee /privacy/out.txt')).resolves.toMatchObject({
      isError: true,
    });
    await expect(run('cp /share/sample.bin ../copy.bin')).resolves.toMatchObject({ isError: true });
    expect(existsSync(join(privacy, 'out.txt'))).toBe(false);
    expect(approveSandboxCommand).toHaveBeenCalledTimes(
      mode === 'read-only' ? 0 : mode === 'approval' ? 9 : 3,
    );
  },
);

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
  const { customTools, appendSystemPrompt } = await agentEnvironment().sessionOptions(
    null,
    '/privacy',
    {
      sessionId: id,
    },
  );
  const prompt = appendSystemPrompt.join('\n');
  expect(prompt).toContain('Mode: request approval');
  expect(prompt).toContain('approval, including read commands');
  expect(prompt).toContain('After approval, supported commands use scoped execution');
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
    content: [{ text: 'The operation was not approved or was cancelled. User note: 改用草稿' }],
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

it.each(['auto-approval', 'read-only'] as const)(
  '%s 直接联网搜索和调用已分类的读取工具',
  async (mode) => {
    database();
    const host = hostPorts();
    const approveToolAction = vi.fn().mockResolvedValue({ approved: false });
    const fetch = vi.fn(async () =>
      Response.json({
        results: [{ title: 'Result', url: 'https://page.example/', content: 'Text' }],
      }),
    );
    vi.stubGlobal('fetch', fetch);
    provideTestHostPorts({ ...host, desktop: { ...host.desktop, approveToolAction } });
    saveWebSearchEntry({ name: 'Search', provider: 'custom', url: 'https://search.example/' });
    const execute = vi.fn().mockResolvedValue({
      ok: true,
      result: { text: 'read result' },
      source: { name: 'Connector' },
      links: [],
    });
    state.mcpDefinitions.mockResolvedValue(
      ['read_item', 'update_item'].map((name) => ({
        type: 'function',
        function: { name, description: name, parameters: {} },
        source: { name: 'Connector' },
        readOnly: name === 'read_item',
        execute,
      })),
    );
    const id = insertSession(null);
    writePermissionMode(id, mode);
    const { customTools } = await agentEnvironment().sessionOptions(null, '/privacy', {
      sessionId: id,
    });
    const run = (name: string, input: unknown) =>
      customTools
        .find((tool) => tool.name === name)!
        .execute('call', input, undefined, undefined, {} as never);
    await expect(run('web_search', { query: 'Delion Bot' })).resolves.toMatchObject({
      content: [{ text: expect.stringContaining('Result') }],
    });
    await expect(run('read_item', {})).resolves.toMatchObject({
      content: [{ text: 'read result' }],
    });
    expect(execute).toHaveBeenCalledExactlyOnceWith({}, undefined, true);
    expect(approveToolAction).not.toHaveBeenCalled();
    if (mode === 'auto-approval')
      await expect(run('update_item', {})).resolves.toMatchObject({ isError: true });
    else expect(customTools.some(({ name }) => name === 'update_item')).toBe(false);
    await expect(run('web_fetch', { url: 'http://127.0.0.1/' })).rejects.toThrow(
      'Network access not approved',
    );
    expect(approveToolAction).toHaveBeenCalledTimes(mode === 'auto-approval' ? 2 : 1);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledTimes(1);
  },
);

it.skipIf(
  !existsSync(
    join('.build', 'scopedfs', process.platform === 'win32' ? 'scopedfs.exe' : 'scopedfs'),
  ),
)('自动批准工作目录增改和只读命令，外部授权只能新建，删除需要审批', async () => {
  database();
  const host = hostPorts();
  const external = mkdtempSync(join(realpathSync('.build'), 'auto-approval-'));
  const existing = join(external, 'existing.txt');
  const created = join(external, 'created.txt');
  const competing = join(external, 'competing.txt');
  writeFileSync(existing, 'original');
  const grants = new Set<string>();
  const approveToolAction = vi.fn<NonNullable<typeof host.desktop.approveToolAction>>(
    async ({ grant, fields }) => {
      const key = grant?.keys[0];
      if (!key) return { approved: false };
      if (fields[0]?.value === competing) writeFileSync(competing, 'concurrent');
      grants.add(key);
      return { approved: true };
    },
  );
  const approveSandboxCommand = vi.fn().mockResolvedValue({ approved: false });
  provideTestHostPorts({
    ...host,
    desktop: { ...host.desktop, approveToolAction, approveSandboxCommand },
  });
  const id = insertSession(null);
  writePermissionMode(id, 'auto-approval');
  const { customTools } = await agentEnvironment().sessionOptions(null, '/privacy', {
    sessionId: id,
  });
  const run = (name: string, input: unknown) =>
    customTools
      .find((tool) => tool.name === name)!
      .execute('call', input, undefined, undefined, {} as never);
  try {
    await expect(
      run('write', { path: '/share/a.txt', content: 'original' }),
    ).resolves.toMatchObject({ content: [{ text: '/share/a.txt' }] });
    await expect(
      run('edit', { path: '/share/a.txt', oldText: 'original', newText: 'changed' }),
    ).resolves.toMatchObject({ content: [{ text: '/share/a.txt' }] });
    await expect(run('mkdir', { path: '/privacy/subfolder' })).resolves.toMatchObject({
      content: [{ text: '/privacy/subfolder' }],
    });
    const command = process.platform === 'win32' ? 'type /share\\a.txt' : 'cat /share/a.txt';
    await expect(run('sandbox_command', { command })).resolves.toMatchObject({
      content: [{ text: 'changed' }],
    });
    expect(approveSandboxCommand).not.toHaveBeenCalled();
    expect(approveToolAction).not.toHaveBeenCalled();
    await expect(
      run('sandbox_command', { command: `${command} > output.txt` }),
    ).resolves.toMatchObject({ isError: true });
    expect(approveSandboxCommand).toHaveBeenCalledOnce();
    await expect(run('delete', { path: '/share/a.txt' })).resolves.toMatchObject({ isError: true });
    expect(readFileSync(join(chatShareDirectory(id), 'a.txt'), 'utf8')).toBe('changed');
    await expect(run('write', { path: existing, content: 'overwrite' })).resolves.toMatchObject({
      isError: true,
    });
    await expect(run('write', { path: created, content: 'new' })).resolves.toMatchObject({
      content: [{ text: created }],
    });
    await expect(run('write', { path: competing, content: 'overwrite' })).resolves.toMatchObject({
      isError: true,
    });
    expect(grants.size).toBe(1);
    expect(readFileSync(existing, 'utf8')).toBe('original');
    expect(readFileSync(created, 'utf8')).toBe('new');
    expect(readFileSync(competing, 'utf8')).toBe('concurrent');
  } finally {
    rmSync(external, { recursive: true, force: true });
  }
});

it('自动批准允许 SSH 项目只读操作，写入和删除在批准前不会发给远端', async () => {
  database();
  const host = hostPorts();
  const approveToolAction = vi.fn().mockResolvedValue({ approved: false });
  provideTestHostPorts({
    ...host,
    desktop: { ...host.desktop, approveToolAction },
    projects: {
      ...host.projects,
      remoteOf: () => ({
        id: 'p1',
        label: 'remote',
        path: '/srv/project',
        remoteId: 'ssh',
        target: { host: 'user@remote' },
      }),
    },
  });
  const id = insertSession('p1');
  state.scopedFile.mockResolvedValue({ error: '无法读取文件' });
  const { customTools } = await agentEnvironment().sessionOptions('p1', '/project', {
    sessionId: id,
  });
  state.scopedFile.mockClear();
  state.scopedFile.mockResolvedValue({ entries: ['source.txt'] });
  const run = (name: string, input: unknown) =>
    customTools
      .find((tool) => tool.name === name)!
      .execute('call', input, undefined, undefined, {} as never);
  await expect(run('ls', { path: '/project' })).resolves.toMatchObject({
    content: [{ text: '["source.txt"]' }],
  });
  for (const name of ['write', 'edit', 'delete']) {
    await expect(
      run(name, {
        path: '/project/source.txt',
        content: 'after',
        oldText: 'before',
        newText: 'after',
      }),
    ).resolves.toMatchObject({ isError: true });
  }
  expect(approveToolAction).toHaveBeenCalledTimes(3);
  expect(state.scopedFile).toHaveBeenCalledExactlyOnceWith(
    '/srv/project',
    expect.objectContaining({ action: 'ls' }),
    expect.any(AbortSignal),
  );
});

describe('受限普通对话', () => {
  it.skipIf(commandTools.length === 0)(
    '默认项目会话加载项目规则及技能描述，并可分页读取完整命令输出',
    async () => {
      database();
      const project = join(root, 'project');
      mkdirSync(project, { recursive: true });
      const rules = 'Use project naming rules.';
      const source = join(project, 'AGENTS.md');
      const skillDir = join(project, '.agents', 'skills', 'test-skill');
      const skillPath = join(skillDir, 'SKILL.md');
      const skill =
        '---\nname: test-skill\ndescription: Validate project files\n---\nRead the test fixtures.\n';
      mkdirSync(skillDir, { recursive: true });
      writeFileSync(source, rules);
      writeFileSync(skillPath, skill);
      const imagePath = join(project, 'pixel.png');
      writeFileSync(
        imagePath,
        Buffer.from(
          'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGOQi1oAAAGyARnBUHQ0AAAAAElFTkSuQmCC',
          'base64',
        ),
      );
      try {
        const full = 'start\n' + 'detail\n'.repeat(9_000) + 'end\n';
        writeFileSync(join(project, 'build.log'), full);
        state.globalSkills = [
          {
            name: 'global-skill',
            description: 'Use the global workflow',
            enabled: true,
            path: join(root, 'home', '.delion-bot', 'skills', 'global-skill', 'SKILL.md'),
          },
        ];
        const id = insertSession('p1');
        const options = await agentEnvironment().sessionOptions('p1', '/project', {
          sessionId: id,
        });
        expect(options.scopedResources?.agentsFiles).toEqual([
          { path: '/project/AGENTS.md', content: rules },
        ]);
        expect(options.scopedResources?.skillPrompt).toContain('Validate project files');
        expect(options.scopedResources?.skillPrompt).not.toContain('Read the test fixtures.');
        expect(options.scopedResources?.skillPrompt).toContain('Use the global workflow');
        const call = (name: string, params: unknown) =>
          options.customTools
            .find((tool) => tool.name === name)!
            .execute('call', params, undefined, undefined, {} as never);
        await expect(call('read_skill', { name: 'test-skill' })).resolves.toMatchObject({
          content: [{ text: skill }],
        });
        await expect(call('read', { path: '/project/pixel.png' })).resolves.toMatchObject({
          content: expect.arrayContaining([
            expect.objectContaining({ type: 'image', mimeType: 'image/png' }),
          ]),
        });
        const command = await call('sandbox_command', {
          command: 'cat /project/build.log | head -n 9002',
        });
        const response = command.content[0]!;
        if (response.type !== 'text') throw new Error('Expected a text command result');
        const result = JSON.parse(response.text);
        expect(result.exitCode).toBe(0);
        expect(result.output.trimEnd()).toMatch(/end$/);
        expect(result.output).not.toContain('start\n');
        expect(result.full_output_path).toMatch(/^\/command-output\//);
        const firstPage = await call('read', { path: result.full_output_path, limit: 2 });
        expect(firstPage).toMatchObject({
          details: { next: { offset: 3 } },
          content: [{ text: expect.stringContaining('"offset":3') }, { text: 'start\ndetail\n' }],
        });
        const nextPage = await call('read', {
          path: result.full_output_path,
          offset: 3,
          limit: 10_000,
        });
        const { next } = nextPage.details as { next: { offset: number } };
        const rest = await call('read', {
          path: result.full_output_path,
          offset: next.offset,
          limit: 10_000,
        });
        expect(
          [firstPage, nextPage, rest]
            .map((page) => {
              const body = page.content.at(-1);
              if (body?.type !== 'text') throw new Error('Expected a text read result');
              return body.text;
            })
            .join(''),
        ).toBe(full);
        const partial = await call('sandbox_command', {
          command: 'head -n 2 /project/build.log && cat /project/../escape',
        });
        const partialText = partial.content[0]!;
        if (partialText.type !== 'text') throw new Error('Expected a text command result');
        expect(JSON.parse(partialText.text)).toMatchObject({
          error: expect.stringContaining('outside the chat directories'),
          output: 'start\ndetail\n',
        });
      } finally {
        state.globalSkills = [];
        rmSync(source);
        rmSync(skillPath);
        rmSync(imagePath);
        rmSync(join(project, 'build.log'), { force: true });
      }
    },
  );

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
    expect(parentPlan).toMatchObject({ mode: 'auto-approval', piCwd: '/privacy' });
    expect(childPlan).toMatchObject({ mode: 'auto-approval', piCwd: '/privacy' });
    expect(parentRoots[1]?.host).toBe(realpathSync(share));
    expect(scopedDirectories(row(child))).toEqual(parentRoots);
  });

  it('只读模式提供读取工具并保持会话路径虚拟化', async () => {
    database();
    const id = insertSession(null);
    writePermissionMode(id, 'read-only');
    const options = await agentEnvironment().sessionOptions(null, '/privacy', {
      sessionId: id,
    });
    const names = options.customTools.map((tool) => tool.name).sort();
    expect(names).toEqual(
      expect.arrayContaining([
        'find',
        'grep',
        'ls',
        'read',
        'read_skill',
        'sandbox_command',
        'session_read',
        'session_search',
        'delion',
        'web_search',
        'web_fetch',
      ]),
    );
    expect(
      names.some((name) => ['write', 'edit', 'mkdir', 'delete', 'download_file'].includes(name)),
    ).toBe(false);
    const delion = options.customTools.find(({ name }) => name === 'delion')!;
    await expect(
      delion.execute('call', { command: 'delete_todo' }, undefined, undefined, {} as never),
    ).resolves.toMatchObject({ isError: true });
    expect(options.commandPrefix).toBeUndefined();
    const prompt = options.appendSystemPrompt.join('\n');
    expect(prompt).toContain('/privacy');
    expect(prompt).toContain('/share');
    expect(prompt).toContain('Read existing files from /privacy and /share');
    expect(prompt).toContain('Mode: read-only');
    expect(prompt).toContain('Retry only after identifying a concrete correction');
    expect(prompt).not.toContain('Use download_file');
    expect(prompt).not.toContain(id);
    expect(prompt).not.toContain('DELION_COMMAND');
    expect(prompt).not.toContain(join(root, 'storage', 'chat-sessions'));
    expect(state.bridge).not.toHaveBeenCalled();
  });

  it('模型提示只推荐当前启用的命令和联网工具', async () => {
    database();
    state.disabledTools.mockReturnValue(new Set(['sandbox_command', 'web_search']));
    const id = insertSession(null);
    writePermissionMode(id, 'read-only');
    const { appendSystemPrompt } = await agentEnvironment().sessionOptions(null, '/privacy', {
      sessionId: id,
    });
    const prompt = appendSystemPrompt.join('\n');
    expect(prompt).toContain('Prefer web_fetch for web queries');
    expect(prompt).not.toContain('web_search');
    expect(prompt).not.toContain('sandbox_command');
    expect(prompt).not.toContain('rg --files');
  });

  it('完全访问保留命令桥，项目默认可直接修改自己的文件', async () => {
    database();
    const id = insertSession(null);
    writePermissionMode(id, 'full');
    const full = await agentEnvironment().sessionOptions(null, row(id).cwd!, {
      sessionId: id,
    });
    expect(full.commandPrefix).toContain('DELION_COMMAND_TOKEN');
    expect(full.appendSystemPrompt.join('\n')).toContain(row(id).cwd!);
    db.prepare(
      `INSERT INTO workspace_entries (id, name, kind, local_path, updated_at) VALUES ('p1', '课题', 'project', ?, 'x')`,
    ).run(join(root, 'project'));
    mkdirSync(join(root, 'project'), { recursive: true });
    const projectId = insertSession('p1');
    expect(launchPlan(row(projectId)).mode).toBe('auto-approval');
    const writable = await agentEnvironment().sessionOptions('p1', '/project', {
      sessionId: projectId,
    });
    expect(writable.customTools.map((tool) => tool.name)).toEqual(
      expect.arrayContaining(['read', 'write', 'edit', 'delete', 'web_search', 'sandbox_command']),
    );
    expect(scopedDirectories(row(projectId)).map(({ name }) => name)).toEqual(['/project']);
  });

  it('未获得用户批准时不写入共享目录', async () => {
    database();
    const id = insertSession(null);
    writePermissionMode(id, 'approval');
    const options = await agentEnvironment().sessionOptions(null, '/privacy', {
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
      writePermissionMode(id, 'approval');
      const { customTools, appendSystemPrompt } = await agentEnvironment().sessionOptions(
        null,
        '/privacy',
        { sessionId: id },
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

  it.skipIf(
    !existsSync(
      join('.build', 'scopedfs', process.platform === 'win32' ? 'scopedfs.exe' : 'scopedfs'),
    ),
  )('命令获批后可运行子进程并读取会话输入副本', async () => {
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
        sessionId: id,
      })
    ).customTools;
    const command = tools.find(({ name }) => name === 'sandbox_command')!;
    const params = {
      command: process.platform === 'win32' ? 'cmd.exe /D /C type inputs\\1' : '/bin/cat inputs/1',
      files: ['/share/input.txt'],
    };
    const execute = () => command.execute('call', params, undefined, undefined, {} as never);
    expect(await execute()).toMatchObject({ isError: true });
    expect(await execute()).toMatchObject({
      content: [{ text: JSON.stringify({ exitCode: 0, output: 'approved input' }) }],
    });
    expect(approveSandboxCommand).toHaveBeenCalledTimes(2);
  });

  it('拒绝时不运行宿主命令，批准后可按原样列出宿主目录', async () => {
    database();
    const approveSandboxCommand = vi
      .fn()
      .mockResolvedValueOnce({ approved: false })
      .mockResolvedValueOnce({ approved: true })
      .mockResolvedValueOnce({ approved: false });
    const host = hostPorts();
    provideTestHostPorts({ ...host, desktop: { ...host.desktop, approveSandboxCommand } });
    const id = insertSession(null);
    writePermissionMode(id, 'approval');
    const directory = mkdtempSync(join(root, 'approved command '));
    writeFileSync(join(directory, 'listed.txt'), '');
    const { customTools } = await agentEnvironment().sessionOptions(null, '/privacy', {
      sessionId: id,
    });
    const tool = customTools.find(({ name }) => name === 'sandbox_command')!;
    const command =
      process.platform === 'win32' ? `dir /b "${directory}"` : `/bin/ls "${directory}"`;
    const execute = () => tool.execute('call', { command }, undefined, undefined, {} as never);
    expect(await execute()).toMatchObject({ isError: true });
    const result = await execute();
    expect(result).toMatchObject({
      content: [{ type: 'text', text: expect.stringMatching(/"exitCode":0.*listed\.txt/) }],
    });
    expect(await execute()).toMatchObject({ isError: true });
    expect(approveSandboxCommand).toHaveBeenCalledTimes(3);
  });

  it('获批命令能在两个虚拟目录间复制文件并从子进程读取', async () => {
    database();
    const approveSandboxCommand = vi.fn().mockResolvedValue({ approved: true });
    const host = hostPorts();
    provideTestHostPorts({ ...host, desktop: { ...host.desktop, approveSandboxCommand } });
    const id = insertSession(null);
    const share = chatShareDirectory(id);
    const privacy = chatSessionDirectory(id);
    const input = '01_原文.txt';
    const output = '02_副本.txt';
    writeFileSync(join(share, input), 'shared content');
    const { customTools } = await agentEnvironment().sessionOptions(null, '/privacy', {
      sessionId: id,
    });
    renameSync(privacy, join(root, `moved-${id}`));
    const tool = customTools.find(({ name }) => name === 'sandbox_command')!;
    const copy =
      process.platform === 'win32'
        ? `copy /share\\${input} /privacy\\${output} >nul`
        : `cp "/share/${input}" "/privacy/${output}"`;
    const command = `${copy} && "${process.execPath}" -e "const fs=require('node:fs');process.stdout.write(fs.readFileSync('/privacy/${output}','utf8')+' '+fs.realpathSync('/privacy'))"`;
    const result = await tool.execute('call', { command }, undefined, undefined, {} as never);
    expect(result).toMatchObject({
      content: [
        { type: 'text', text: JSON.stringify({ exitCode: 0, output: 'shared content /privacy' }) },
      ],
    });
    expect(approveSandboxCommand).toHaveBeenCalledWith(expect.objectContaining({ command }));
    expect(readFileSync(join(privacy, output), 'utf8')).toBe('shared content');
    expect(readFileSync(join(share, input), 'utf8')).toBe('shared content');
  });

  it.skipIf(
    !existsSync(
      join('.build', 'scopedfs', process.platform === 'win32' ? 'scopedfs.exe' : 'scopedfs'),
    ),
  )('外部普通文件可只读访问，凭据和其他会话目录保持隔离', async () => {
    database();
    const directory = mkdtempSync(join(realpathSync('.build'), 'ambient-read-'));
    const file = join(directory, 'normal.txt');
    const credential = join(directory, '.env');
    const other = chatShareDirectory(insertSession(null));
    const otherFile = join(other, 'private.txt');
    try {
      writeFileSync(file, 'ordinary file');
      writeFileSync(credential, 'secret');
      writeFileSync(otherFile, 'private');
      const id = insertSession(null);
      const { customTools } = await agentEnvironment().sessionOptions(null, '/privacy', {
        sessionId: id,
      });
      const run = (name: string, path: string) =>
        customTools
          .find((tool) => tool.name === name)!
          .execute('call', { path }, undefined, undefined, {} as never);
      expect(await run('read', file)).toMatchObject({ content: [{ text: 'ordinary file' }] });
      expect(await run('ls', directory)).toMatchObject({ content: [{ text: '["normal.txt"]' }] });
      expect(await run('read', credential)).toMatchObject({ isError: true });
      expect(await run('read', otherFile)).toMatchObject({ isError: true });
      expect(await run('write', file)).toMatchObject({ isError: true });
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
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
  )('默认权限可直接写入本地项目，无法访问普通聊天目录', async () => {
    const approve = vi.fn().mockResolvedValue({ approved: false });
    database();
    const host = hostPorts();
    provideTestHostPorts({ ...host, desktop: { ...host.desktop, approveToolAction: approve } });
    const project = join(root, 'project');
    mkdirSync(project, { recursive: true });
    const id = insertSession('p1');
    const options = await agentEnvironment().sessionOptions('p1', '/project', {
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
    expect(() => referenceFilePath(id, secret)).toThrow(
      'The path is outside the chat directories.',
    );
    expect(() => referenceFilePath(id, '/share/outside/delion.db')).toThrow(
      'The link is outside the chat directories.',
    );
    expect(() => referenceFilePath(id, '/privacy/../../etc/passwd')).toThrow(
      'The path is outside the chat directories.',
    );
    expect(() => referenceFilePath(id, note)).toThrow('The path is outside the chat directories.');
    const shared = join(chatShareDirectory(id), 'shared.txt');
    writeFileSync(shared, 'shared');
    expect(referenceFilePath(id, '/share/shared.txt')).toBe(realpathSync(shared));
  });
});
