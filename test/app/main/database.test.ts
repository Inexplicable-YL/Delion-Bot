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
