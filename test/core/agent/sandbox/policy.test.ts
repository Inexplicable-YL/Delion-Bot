import Database from 'better-sqlite3';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  bridge: vi.fn(() => ({ url: 'http://127.0.0.1:9/', token: 'token', close() {} })),
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
  mcpToolDefinitions: async () => [],
  executeMcpTool: vi.fn(),
}));
vi.mock('../../../../src/core/capabilities/command-server', () => ({
  COMMAND_BRIDGE: 'delion() { :; }',
  startDomainBridge: () => state.bridge(),
}));
vi.mock('../../../../src/core/capabilities/tools', () => ({
  readDisabledTools: () => new Set<string>(),
}));

import { agentEnvironment } from '../../../../src/core/agent/environment';
import { launchPlan, scopedDirectories } from '../../../../src/core/agent/sandbox/mode';
import { sandboxPath, resolveVirtualHost } from '../../../../src/core/agent/sandbox/paths';
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
let db: Database.Database;

function database(
  approveFileChange?: NonNullable<ReturnType<typeof hostPorts>['desktop']['approveFileChange']>,
) {
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
  db?.close();
});

describe('路径契约', () => {
  it('把 privacy 和 share 映射进沙箱，不把它们解析到宿主目录', () => {
    expect(sandboxPath('privacy/a.txt')).toBe('/privacy/a.txt');
    expect(sandboxPath('/share')).toBe('/share');
    expect(sandboxPath('notes/a.txt')).toBe('/privacy/notes/a.txt');
    expect(sandboxPath('/etc/hosts')).toBe('/etc/hosts');
    expect(sandboxPath('C:/secret/db')).toBe('C:/secret/db');
    expect(sandboxPath('\\\\server\\share\\a')).toBe('//server/share/a');
    expect(sandboxPath('~/cache')).toBe('/privacy/.home/cache');
  });

  it('虚拟链接不能通过 .. 离开两个根', () => {
    const roots = { privacy: '/data/privacy', share: '/data/share' };
    expect(resolveVirtualHost('/privacy/a.txt', roots)).toEqual({
      kind: 'host',
      path: resolve(roots.privacy, 'a.txt'),
    });
    expect(resolveVirtualHost('/privacy/../../etc/passwd', roots)).toEqual({ kind: 'denied' });
    expect(resolveVirtualHost('/share/../secret', roots)).toEqual({ kind: 'denied' });
    expect(resolveVirtualHost('/etc/hosts', roots)).toEqual({ kind: 'passthrough' });
    expect(fileLinkKey('/privacy/a.txt', '/data/chat-sessions/uuid', null, true)).toBe(
      '/privacy/a.txt',
    );
    expect(fileLinkKey('src/a.ts', '/data/chat-sessions/uuid', null, true)).toBe(
      '/data/chat-sessions/uuid/src/a.ts',
    );
  });
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
    expect(parentPlan).toMatchObject({ mode: 'read-only', piCwd: '/privacy' });
    expect(childPlan.piCwd).toBe('/privacy');
    expect(parentRoots[1]?.host).toBe(share);
    expect(scopedDirectories(row(child))).toEqual(parentRoots);
  });

  it('工具列表没有网络、MCP、会话读取和命令桥，提示词不含会话 id', async () => {
    database();
    const id = insertSession(null);
    const options = await agentEnvironment().sessionOptions(null, '/privacy', {
      askCards: false,
      sessionId: id,
    });
    const names = options.customTools.map((tool) => tool.name).sort();
    expect(names).toEqual(['ls', 'read']);
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

  it('完全访问保留命令桥，项目默认只读，项目内修改只增加项目文件写入', async () => {
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
    const project = await agentEnvironment().sessionOptions('p1', join(root, 'project'), {
      askCards: false,
      sessionId: projectId,
    });
    expect(project.commandPrefix).toBeUndefined();
    expect(project.customTools.map((tool) => tool.name)).toEqual(['read', 'ls']);
    writePermissionMode(projectId, 'project-write');
    const writable = await agentEnvironment().sessionOptions('p1', '/project', {
      askCards: false,
      sessionId: projectId,
    });
    expect(writable.customTools.map((tool) => tool.name)).toEqual(['read', 'ls', 'write', 'edit']);
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

  it.skipIf(
    !existsSync(
      join('.build', 'scopedfs', process.platform === 'win32' ? 'scopedfs.exe' : 'scopedfs'),
    ),
  )('每次单独批准写入，共享目录和私有目录分开', async () => {
    const approve = vi.fn().mockResolvedValueOnce(true).mockResolvedValueOnce(false);
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
    expect(referenceFilePath(id, '/share/shared.txt')).toBe(shared);
  });
});
