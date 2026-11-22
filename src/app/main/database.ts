import Database from 'better-sqlite3';
import { join } from 'node:path';
import { mkdirSync } from 'node:fs';
import { hostPorts } from '../../core/ports';

let database: Database.Database | null = null;

const schema: string[] = [
  `CREATE TABLE IF NOT EXISTS remotes (
    id TEXT PRIMARY KEY,
    label TEXT NOT NULL,
    host TEXT NOT NULL,
    port INTEGER,
    key_path TEXT,
    created_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_remotes_host ON remotes(host, port)`,
  `CREATE TABLE IF NOT EXISTS workspace_entries (
    id TEXT PRIMARY KEY,
    parent_id TEXT REFERENCES workspace_entries(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    kind TEXT NOT NULL,
    source_id TEXT,
    local_path TEXT,
    remote_id TEXT REFERENCES remotes(id) ON DELETE RESTRICT,
    updated_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS workspace_parent ON workspace_entries(parent_id)`,
  `CREATE TABLE IF NOT EXISTS workspace_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)`,
  `INSERT OR IGNORE INTO workspace_entries (id, parent_id, name, kind, source_id, local_path, updated_at)
    VALUES ('00000000-0000-4000-8000-000000000001', NULL, '归档', 'folder', NULL, NULL, '2026-10-07T00:00:00.000Z')`,
  `CREATE TABLE IF NOT EXISTS notifications (
    id TEXT PRIMARY KEY,
    source TEXT NOT NULL,
    account_key TEXT NOT NULL,
    title TEXT NOT NULL,
    body TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    read_at TEXT,
    href TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_notifications_account_source_created
    ON notifications (account_key, source, created_at DESC)`,
  `CREATE TABLE IF NOT EXISTS notification_refreshes (
    source TEXT NOT NULL,
    account_key TEXT NOT NULL,
    last_success_at TEXT,
    error TEXT,
    PRIMARY KEY (source, account_key)
  )`,
  `CREATE TABLE IF NOT EXISTS todo_items (
    id TEXT PRIMARY KEY,
    data TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    project_id TEXT REFERENCES workspace_entries(id) ON DELETE SET NULL,
    cwd TEXT,
    file TEXT NOT NULL,
    title TEXT NOT NULL DEFAULT '新对话',
    title_temporary INTEGER NOT NULL DEFAULT 0,
    message_count INTEGER NOT NULL DEFAULT 0,
    archived INTEGER NOT NULL DEFAULT 0,
    pinned INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    provider_id TEXT,
    model TEXT,
    effort TEXT,
    parent_id TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS idx_sessions_visibility ON sessions(project_id, archived, pinned, updated_at DESC)`,
];

const createConsentRecords = `CREATE TABLE IF NOT EXISTS consent_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  document TEXT NOT NULL,
  revision TEXT NOT NULL,
  app_version TEXT NOT NULL,
  accepted_at TEXT NOT NULL
)`;

export const SCHEMA_VERSION = 2;

export function getDatabase(): Database.Database {
  if (database) return database;
  const dir = hostPorts().paths.userData();
  mkdirSync(dir, { recursive: true });
  const db = new Database(join(dir, 'delion.db'));
  try {
    const version = db.pragma('user_version', { simple: true }) as number;
    if (version !== 0 && version !== 1 && version !== SCHEMA_VERSION)
      throw new Error('数据库格式不受支持，请使用当前版本创建的数据目录');
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    db.transaction(() => {
      if (version === 1) {
        db.exec('ALTER TABLE sessions ADD COLUMN title_temporary INTEGER NOT NULL DEFAULT 0');
        db.exec("UPDATE sessions SET title_temporary=1 WHERE message_count=0 AND title='新对话'");
      }
      for (const statement of schema) db.exec(statement);
      db.exec(createConsentRecords);
      db.pragma(`user_version = ${SCHEMA_VERSION}`);
    })();
  } catch (error) {
    db.close();
    throw error;
  }
  database = db;
  return db;
}

export function closeDatabase(): void {
  database?.close();
  database = null;
}
