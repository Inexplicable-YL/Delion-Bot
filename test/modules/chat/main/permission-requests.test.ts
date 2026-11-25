import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';
import { beforeEach, describe, expect, it } from 'vitest';
import { provideTestHostPorts } from '../../../core/host-mock';
import {
  decidePermissionRequest,
  permissionRequests,
  requestChatPermission,
} from '../../../../src/modules/chat/main/permission-requests';

let db: Database.Database;

beforeEach(() => {
  db = new Database(':memory:');
  db.exec(`
    CREATE TABLE sessions (
      id TEXT PRIMARY KEY, project_id TEXT, cwd TEXT, file TEXT, title TEXT,
      title_temporary INTEGER, archived INTEGER, provider_id TEXT, model TEXT,
      effort TEXT, parent_id TEXT
    );
    CREATE TABLE workspace_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  `);
  provideTestHostPorts({ database: () => db });
});

const session = (projectId: string | null) => {
  const id = randomUUID();
  db.prepare('INSERT INTO sessions (id, project_id) VALUES (?, ?)').run(id, projectId);
  return id;
};

const ask = (sessionId: string, keys: string[]) =>
  requestChatPermission(
    sessionId,
    { kind: 'operation', title: '运行受限命令', fields: [], grant: { keys, label: '运行命令' } },
    new AbortController().signal,
  );

describe('审批请求', () => {
  it('只接受所属会话对同一条请求的一次决定', async () => {
    const sessionId = session(null);
    const requested = requestChatPermission(
      sessionId,
      { kind: 'full', title: 'Approve', fields: [] },
      new AbortController().signal,
    );
    const [request] = permissionRequests(sessionId);
    expect(request?.kind).toBe('full');
    const id = request!.id;
    expect(decidePermissionRequest({ sessionId: randomUUID(), id, decision: 'once' })).toBe(false);
    expect(decidePermissionRequest({ sessionId, id, decision: 'always' })).toBe(false);
    expect(decidePermissionRequest({ sessionId, id, decision: 'once' })).toBe(true);
    expect(decidePermissionRequest({ sessionId, id, decision: 'once' })).toBe(false);
    await expect(requested).resolves.toEqual({ approved: true });
  });

  it('取消操作后立即撤回审批', async () => {
    const sessionId = session(null);
    const cancellation = new AbortController();
    const requested = requestChatPermission(
      sessionId,
      { kind: 'operation', title: 'Approve', fields: [] },
      cancellation.signal,
    );
    const [request] = permissionRequests(sessionId);
    cancellation.abort();
    expect(permissionRequests(sessionId)).toEqual([]);
    expect(decidePermissionRequest({ sessionId, id: request!.id, decision: 'once' })).toBe(false);
    await expect(requested).resolves.toEqual({ approved: false });
  });

  it('拒绝时把说明交回 Agent', async () => {
    const sessionId = session(null);
    const requested = ask(sessionId, ['command:grep']);
    const [request] = permissionRequests(sessionId);
    decidePermissionRequest({ sessionId, id: request!.id, decision: 'deny', note: '改用 sed' });
    await expect(requested).resolves.toEqual({ approved: false, note: '改用 sed' });
  });
});

describe('始终允许', () => {
  it('普通聊天只在本会话内免审批，且要覆盖全部程序', async () => {
    const sessionId = session(null);
    const first = ask(sessionId, ['command:grep', 'command:wc']);
    const [request] = permissionRequests(sessionId);
    expect(request?.grant).toEqual({ label: '运行命令', scope: 'session' });
    decidePermissionRequest({ sessionId, id: request!.id, decision: 'always' });
    await expect(first).resolves.toEqual({ approved: true });

    await expect(ask(sessionId, ['command:wc'])).resolves.toEqual({ approved: true });
    void ask(sessionId, ['command:grep', 'command:rm']);
    expect(permissionRequests(sessionId)).toHaveLength(1);
    void ask(session(null), ['command:grep']);
    expect(db.prepare('SELECT COUNT(*) AS count FROM workspace_settings').get()).toEqual({
      count: 0,
    });
  });

  it('项目聊天的授权保存到项目，并放行同项目其他会话里等待中的同类请求', async () => {
    const projectId = randomUUID();
    const sessionId = session(projectId);
    const sibling = session(projectId);
    const first = ask(sessionId, ['file-change']);
    const waiting = ask(sibling, ['file-change']);
    const [request] = permissionRequests(sessionId);
    expect(request?.grant?.scope).toBe('project');
    decidePermissionRequest({ sessionId, id: request!.id, decision: 'always' });
    await expect(first).resolves.toEqual({ approved: true });
    await expect(waiting).resolves.toEqual({ approved: true });
    await expect(ask(session(projectId), ['file-change'])).resolves.toEqual({ approved: true });

    const other = session(randomUUID());
    void ask(other, ['file-change']);
    expect(permissionRequests(other)).toHaveLength(1);
  });
});
