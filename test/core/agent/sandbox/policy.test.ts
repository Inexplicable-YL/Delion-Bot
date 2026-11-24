import Database from 'better-sqlite3';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  available: true,
  runs: [] as string[][],
  bridge: vi.fn(() => ({ url: 'http://127.0.0.1:9/', token: 'token', close() {} })),
}));

vi.mock('electron', () => ({ app: { getPath: () => '/tmp/delion-sandbox-policy' } }));
vi.mock('../../../../src/core/agent/sandbox/linux', () => ({
  linuxSandboxAvailability: () =>
    state.available
      ? { ok: true }
      : { ok: false, reason: '受限模式无法启动，已停止执行，没有改用当前用户的本机权限。' },
  assertLinuxSandbox: () => {
    if (!state.available)
      throw new Error('受限模式无法启动，已停止执行，没有改用当前用户的本机权限。');
  },
  runSandboxed: vi.fn(async (_roots: unknown, file: string, args: string[]) => {
    state.runs.push([file, ...args]);
    return { code: 0, stdout: Buffer.from('ok'), stderr: '', truncated: false };
  }),
}));
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
import { launchPlan } from '../../../../src/core/agent/sandbox/mode';
import { sandboxPath, resolveVirtualHost } from '../../../../src/core/agent/sandbox/paths';
import { sandboxTools } from '../../../../src/core/agent/sandbox/tools';
import { fileLinkKey } from '../../../../src/modules/chat/view/reference-tokens';
import { provideTestHostPorts } from '../../host-mock';
import {
  chatDeliveryDirectory,
  insertSession,
  row,
  writePermissionMode,
} from '../../../../src/core/agent/session/store';

const root = mkdtempSync(join(tmpdir(), 'delion-sandbox-policy-'));
let db: Database.Database;

function database() {
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
  state.available = true;
  state.runs = [];
  db?.close();
});

describe('路径契约', () => {
  it('把 privacy 和 delivery 映射进沙箱，不把它们解析到宿主目录', () => {
    expect(sandboxPath('privacy/a.txt')).toBe('/privacy/a.txt');
    expect(sandboxPath('/delivery')).toBe('/delivery');
    expect(sandboxPath('notes/a.txt')).toBe('/privacy/notes/a.txt');
    expect(sandboxPath('/etc/hosts')).toBe('/etc/hosts');
    expect(sandboxPath('~/cache')).toBe('/privacy/.home/cache');
  });

  it('虚拟链接不能通过 .. 离开两个根', () => {
    const roots = { privacy: '/data/privacy', delivery: '/data/delivery' };
    expect(resolveVirtualHost('/privacy/a.txt', roots)).toEqual({
      kind: 'host',
      path: '/data/privacy/a.txt',
    });
    expect(resolveVirtualHost('/privacy/../../etc/passwd', roots)).toEqual({ kind: 'denied' });
    expect(resolveVirtualHost('/delivery/../secret', roots)).toEqual({ kind: 'denied' });
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
  it('默认受限，交付目录名不是会话 id，子会话共用父目录', async () => {
    database();
    const id = insertSession(null);
    const delivery = chatDeliveryDirectory(id);
    expect(delivery.replaceAll('\\', '/')).toMatch(new RegExp(`/chat-delivery/${id}$`));
    const child = '22222222-2222-4222-8222-222222222222';
    db.prepare(
      'INSERT INTO sessions (id, cwd, file, parent_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(child, row(id).cwd, '', id, 'x', 'x');
    const parentPlan = launchPlan(row(id));
    const childPlan = launchPlan(row(child));
    expect(parentPlan).toMatchObject({ mode: 'restricted', piCwd: '/privacy' });
    expect(childPlan.piCwd).toBe('/privacy');
    expect(parentPlan.roots?.deliveryHost).toBe(delivery);
    expect(childPlan.roots?.privacyHost).toBe(parentPlan.roots?.privacyHost);
    expect(childPlan.roots?.deliveryHost).toBe(parentPlan.roots?.deliveryHost);
    expect(parentPlan.roots?.privacyHost).not.toContain('undefined');
  });

  it('工具列表没有网络、MCP、会话读取和命令桥，提示词不含会话 id', async () => {
    database();
    const id = insertSession(null);
    const options = await agentEnvironment().sessionOptions(null, '/privacy', {
      askCards: false,
      sessionId: id,
    });
    const names = options.customTools.map((tool) => tool.name).sort();
    expect(names).toEqual(['bash', 'edit', 'find', 'grep', 'ls', 'read', 'write']);
    expect(options.commandPrefix).toBeUndefined();
    const prompt = options.appendSystemPrompt.join('\n');
    expect(prompt).toContain('/privacy');
    expect(prompt).toContain('/delivery');
    expect(prompt).not.toContain(id);
    expect(prompt).not.toContain('DELION_COMMAND');
    expect(prompt).not.toContain(join(root, 'storage', 'chat-sessions'));
    expect(state.bridge).not.toHaveBeenCalled();
  });

  it('完全权限保留命令桥，项目会话不进入受限分支', async () => {
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
    const projectId = insertSession('p1');
    const project = await agentEnvironment().sessionOptions('p1', join(root, 'project'), {
      askCards: false,
      sessionId: projectId,
    });
    expect(project.commandPrefix).toContain('DELION_COMMAND_TOKEN');
    expect(project.customTools.map((tool) => tool.name)).toEqual(
      expect.arrayContaining(['web_fetch', 'session_read']),
    );
  });

  it('隔离后端不可用时拒绝构建工具，而不是返回宿主工具', async () => {
    database();
    const id = insertSession(null);
    state.available = false;
    await expect(
      agentEnvironment().sessionOptions(null, '/tmp', { askCards: false, sessionId: id }),
    ).rejects.toThrow(/没有改用当前用户的本机权限/);
    expect(state.runs).toEqual([]);
  });

  it('写入工具把目标交给沙箱路径，不直接写宿主路径', async () => {
    database();
    const id = insertSession(null);
    const plan = launchPlan(row(id));
    const write = (await sandboxTools(plan.roots!)).find((tool) => tool.name === 'write')!;
    await write.execute(
      '1',
      { path: 'privacy/note.txt', content: 'hello' },
      undefined,
      undefined,
      {} as never,
    );
    expect(state.runs[0]?.[0]).toBe('/usr/bin/python3');
    expect(state.runs[0]).toContain('/privacy/note.txt');
    expect(state.runs[0]?.join(' ')).not.toContain(id);
  });
});
