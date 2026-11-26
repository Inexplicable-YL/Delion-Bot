import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';

const state = vi.hoisted(() => ({ root: '' }));
import { closeDatabase, getDatabase, SCHEMA_VERSION } from '../../../src/app/main/database';
import { provideTestHostPorts } from '../../core/host-mock';

function freshRoot(): string {
  state.root = mkdtempSync(join(tmpdir(), 'delion-db-'));
  provideTestHostPorts({ paths: { userData: () => state.root } });
  return state.root;
}

afterEach(() => {
  closeDatabase();
  rmSync(state.root, { recursive: true, force: true });
});

describe('current database format', () => {
  it('creates and reopens the current database without losing data', () => {
    freshRoot();
    const db = getDatabase();
    expect(db.pragma('user_version', { simple: true })).toBe(SCHEMA_VERSION);
    expect(db.pragma('foreign_keys', { simple: true })).toBe(1);
    db.prepare('INSERT INTO workspace_settings VALUES (?, ?)').run('test', 'value');
    closeDatabase();
    expect(
      getDatabase().prepare("SELECT value FROM workspace_settings WHERE key='test'").get(),
    ).toEqual({ value: 'value' });
  });

  it('preserves existing titles when adding temporary title tracking', () => {
    freshRoot();
    const db = getDatabase();
    db.exec('ALTER TABLE sessions DROP COLUMN title_temporary');
    db.pragma('user_version = 1');
    db.exec(
      `INSERT INTO sessions (id, file, title, message_count, created_at, updated_at)
       VALUES ('empty', '', '新对话', 0, 'now', 'now'), ('used', '', '我的标题', 1, 'now', 'now')`,
    );
    closeDatabase();

    expect(
      getDatabase().prepare('SELECT title, title_temporary FROM sessions ORDER BY id').all(),
    ).toEqual([
      { title: '新对话', title_temporary: 1 },
      { title: '我的标题', title_temporary: 0 },
    ]);
  });

  it('keeps at most 10,000 approval decisions and purges expired rows on write and reopen', () => {
    freshRoot();
    const db = getDatabase();
    const insert = db.prepare(
      `INSERT INTO permission_decisions VALUES (?, 'session', NULL, 'tool', 'Approve', 'once', 'once', '[]', ?)`,
    );
    const expired = '2020-01-01T00:00:00.000Z';
    insert.run('expired', expired);
    expect(
      db.prepare("SELECT request_id FROM permission_decisions WHERE request_id = 'expired'").get(),
    ).toBeUndefined();
    db.prepare(
      `WITH RECURSIVE decisions(id) AS (
        SELECT 1 UNION ALL SELECT id + 1 FROM decisions WHERE id < 10001
      )
      INSERT INTO permission_decisions
      SELECT id, 'session', NULL, 'tool', 'Approve', 'once', 'once', '[]', ? FROM decisions`,
    ).run(new Date().toISOString());
    expect(db.prepare('SELECT COUNT(*) AS count FROM permission_decisions').get()).toEqual({
      count: 10000,
    });
    expect(
      db.prepare('SELECT request_id FROM permission_decisions ORDER BY rowid LIMIT 1').get(),
    ).toEqual({ request_id: '2' });
    db.prepare("UPDATE permission_decisions SET decided_at = ? WHERE request_id = '2'").run(
      expired,
    );
    closeDatabase();

    expect(
      getDatabase().prepare('SELECT COUNT(*) AS count FROM permission_decisions').get(),
    ).toEqual({
      count: 9999,
    });
  });

  it('rejects a database from a newer version without clearing its data', () => {
    const root = freshRoot();
    const db = new Database(join(root, 'delion.db'));
    db.exec('CREATE TABLE sample (value TEXT)');
    db.exec("INSERT INTO sample VALUES ('keep')");
    db.pragma(`user_version = ${SCHEMA_VERSION + 1}`);
    db.close();
    expect(() => getDatabase()).toThrow('数据库格式不受支持');
    const stored = new Database(join(root, 'delion.db'));
    expect(stored.prepare('SELECT value FROM sample').get()).toEqual({ value: 'keep' });
    stored.close();
  });
});
