import { createHash, randomUUID } from 'node:crypto';
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
    CREATE TABLE permission_decisions (
      request_id TEXT PRIMARY KEY, session_id TEXT NOT NULL, project_id TEXT,
      capability TEXT NOT NULL, title TEXT NOT NULL, decision TEXT NOT NULL,
      scope TEXT NOT NULL, grant_fingerprints TEXT NOT NULL, decided_at TEXT NOT NULL
    );
  `);
  provideTestHostPorts({ database: () => db });
});

const session = (projectId: string | null) => {
  const id = randomUUID();
  db.prepare('INSERT INTO sessions (id, project_id) VALUES (?, ?)').run(id, projectId);
  return id;
};

const ask = (sessionId: string, keys: string[], capability: 'command' | 'file' = 'command') =>
  requestChatPermission(
    sessionId,
    {
      capability,
      kind: 'operation',
      title: '运行受限命令',
      fields: [{ label: '参数', value: 'sensitive input' }],
      grant: { keys, label: '运行命令' },
    },
    new AbortController().signal,
  );

describe('审批请求', () => {
  it('只接受所属会话对同一条请求的一次决定', async () => {
    const sessionId = session(null);
    const requested = requestChatPermission(
      sessionId,
      { capability: 'full', kind: 'full', title: 'Approve', fields: [] },
      new AbortController().signal,
    );
    const [request] = permissionRequests(sessionId);
    expect(request?.kind).toBe('full');
    const id = request!.id;
    expect(decidePermissionRequest({ sessionId: randomUUID(), id, decision: 'once' })).toBe(false);
    expect(decidePermissionRequest({ sessionId, id, decision: 'always' })).toBe(false);
    expect(decidePermissionRequest({ sessionId, id, decision: 'directory' })).toBe(false);
    expect(decidePermissionRequest({ sessionId, id, decision: 'once' })).toBe(true);
    expect(decidePermissionRequest({ sessionId, id, decision: 'once' })).toBe(false);
    await expect(requested).resolves.toEqual({ approved: true });
    expect(
      db.prepare('SELECT capability, decision, scope FROM permission_decisions').all(),
    ).toEqual([{ capability: 'full', decision: 'once', scope: 'once' }]);
  });

  it('取消操作后立即撤回审批', async () => {
    const sessionId = session(null);
    const cancellation = new AbortController();
    const requested = requestChatPermission(
      sessionId,
      { capability: 'tool', kind: 'operation', title: 'Approve', fields: [] },
      cancellation.signal,
    );
    const [request] = permissionRequests(sessionId);
    cancellation.abort();
    expect(permissionRequests(sessionId)).toEqual([]);
    expect(decidePermissionRequest({ sessionId, id: request!.id, decision: 'once' })).toBe(false);
    await expect(requested).resolves.toEqual({ approved: false });
    expect(db.prepare('SELECT capability, decision FROM permission_decisions').get()).toEqual({
      capability: 'tool',
      decision: 'cancelled',
    });
  });

  it('拒绝时把说明交回 Agent', async () => {
    const sessionId = session(null);
    const requested = ask(sessionId, ['command:grep']);
    const [request] = permissionRequests(sessionId);
    decidePermissionRequest({ sessionId, id: request!.id, decision: 'deny', note: '改用 sed' });
    await expect(requested).resolves.toEqual({ approved: false, note: '改用 sed' });
    const logged = db
      .prepare('SELECT * FROM permission_decisions WHERE request_id = ?')
      .get(request!.id);
    expect(logged).toMatchObject({ capability: 'command', decision: 'deny', scope: 'session' });
    expect(JSON.stringify(logged)).not.toMatch(/改用 sed|sensitive input|command:grep/);
  });
});

describe('始终允许', () => {
  it('保存目录授权后放行同目录请求，只记录用户作出的决定', async () => {
    const projectId = randomUUID();
    const owner = session(projectId);
    const sibling = session(projectId);
    const write = (sessionId: string, directory: string, name: string) =>
      requestChatPermission(
        sessionId,
        {
          capability: 'file',
          kind: 'operation',
          title: '写入文件',
          fields: [],
          grant: {
            label: name,
            keys: [`write:${directory}/${name}`],
            directory: { label: directory, key: `write-directory:${directory}` },
          },
        },
        new AbortController().signal,
      );
    const first = write(owner, '/project/reports', 'a.txt');
    const waiting = write(sibling, '/project/reports', 'b.txt');
    const childDirectory = write(sibling, '/project/reports/weekly', 'c.txt');
    const [request] = permissionRequests(owner);
    expect(request?.grant).toMatchObject({ scope: 'project', directoryLabel: '/project/reports' });
    expect(
      decidePermissionRequest({ sessionId: owner, id: request!.id, decision: 'directory' }),
    ).toBe(true);

    await expect(first).resolves.toEqual({ approved: true });
    await expect(waiting).resolves.toEqual({ approved: true });
    await expect(write(session(projectId), '/project/reports', 'd.txt')).resolves.toEqual({
      approved: true,
    });
    expect(permissionRequests(sibling)).toHaveLength(1);
    const [remaining] = permissionRequests(sibling);
    decidePermissionRequest({ sessionId: sibling, id: remaining!.id, decision: 'deny' });
    await expect(childDirectory).resolves.toEqual({ approved: false });
    const log = db
      .prepare(
        "SELECT decision, grant_fingerprints FROM permission_decisions WHERE decision IN ('directory', 'grant') ORDER BY rowid",
      )
      .all();
    expect(log).toEqual([
      {
        decision: 'directory',
        grant_fingerprints: JSON.stringify([
          createHash('sha256').update('write-directory:/project/reports').digest('hex'),
        ]),
      },
    ]);
  });

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
    const first = ask(sessionId, ['file:/project/a.txt:write'], 'file');
    const waiting = ask(sibling, ['file:/project/a.txt:write'], 'file');
    const differentFile = ask(sibling, ['file:/project/b.txt:write'], 'file');
    const [request] = permissionRequests(sessionId);
    expect(request?.grant?.scope).toBe('project');
    decidePermissionRequest({ sessionId, id: request!.id, decision: 'always' });
    await expect(first).resolves.toEqual({ approved: true });
    await expect(waiting).resolves.toEqual({ approved: true });
    const next = session(projectId);
    await expect(ask(next, ['file:/project/a.txt:write'], 'file')).resolves.toEqual({
      approved: true,
    });
    expect(
      db
        .prepare(
          'SELECT session_id, project_id, capability, decision, scope FROM permission_decisions ORDER BY rowid',
        )
        .all(),
    ).toEqual([
      {
        session_id: sessionId,
        project_id: projectId,
        capability: 'file',
        decision: 'always',
        scope: 'project',
      },
    ]);
    const [remaining] = permissionRequests(sibling);
    expect(remaining).toBeDefined();
    decidePermissionRequest({ sessionId: sibling, id: remaining!.id, decision: 'deny' });
    await expect(differentFile).resolves.toEqual({ approved: false });

    const other = session(randomUUID());
    void ask(other, ['file:/project/a.txt:write'], 'file');
    expect(permissionRequests(other)).toHaveLength(1);
  });
});
