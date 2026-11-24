import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, statSync } from 'node:fs';
import { join, sep } from 'node:path';
import type { ChatSessionSummary, PermissionMode } from '../../protocol/agent';
import { llmModelSettings } from '../../protocol/llm-models';
import type { StoredLlmProvider } from '../llm-config';
import { hostPorts } from '../../ports';
import { llmProviders, usableLlmProviders } from '../providers';
import type { SessionModel } from '../pi';

export interface SessionRow {
  id: string;
  project_id: string | null;
  cwd: string | null;
  file: string;
  title: string;
  title_temporary: number;
  archived: number;
  provider_id: string | null;
  model: string | null;
  effort: string | null;
  parent_id: string | null;
}

export function row(id: string): SessionRow {
  const found = hostPorts()
    .database()
    .prepare(
      'SELECT id, project_id, cwd, file, title, title_temporary, archived, provider_id, model, effort, parent_id FROM sessions WHERE id=?',
    )
    .get(id) as SessionRow | undefined;
  if (!found) throw new Error('会话不存在');
  return found;
}

export function workspaceRoot() {
  const root = join(hostPorts().paths.storage(), 'workspace');
  mkdirSync(root, { recursive: true });
  return root;
}

export function chatSessionDirectory(id: string) {
  const dir = join(hostPorts().paths.storage(), 'chat-sessions', id);
  mkdirSync(dir, { recursive: true });
  return dir;
}

const permissionKey = (id: string) => `session-permission:${id}`;

function setting(key: string): string | undefined {
  return (
    hostPorts().database().prepare('SELECT value FROM workspace_settings WHERE key=?').get(key) as
      { value: string } | undefined
  )?.value;
}

export function readPermissionMode(id: string): PermissionMode {
  const mode = setting(permissionKey(id));
  if (mode === 'full-confirmed') return 'full';
  return mode === 'approval' || mode === 'project-write' ? mode : 'read-only';
}

export function writePermissionMode(id: string, mode: PermissionMode) {
  hostPorts()
    .database()
    .prepare('INSERT OR REPLACE INTO workspace_settings VALUES (?, ?)')
    .run(permissionKey(id), mode === 'full' ? 'full-confirmed' : mode);
}

export function chatShareDirectory(id: string) {
  const dir = join(hostPorts().paths.storage(), 'chat-share', id);
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function ensurePrivateSession(id: string): string {
  const dir = chatSessionDirectory(id);
  mkdirSync(join(dir, '.home'), { recursive: true });
  mkdirSync(join(dir, '.cache'), { recursive: true });
  hostPorts()
    .database()
    .prepare('UPDATE sessions SET cwd=? WHERE id=? AND (cwd IS NULL OR cwd<>?)')
    .run(dir, id, dir);
  chatShareDirectory(id);
  return dir;
}

export function sessionCwd(projectId: string | null, stored: string | null): string {
  if (stored) return stored;
  const path = projectId === null ? workspaceRoot() : hostPorts().projects.find(projectId)?.path;
  if (!path) throw new Error('项目不存在');
  if (projectId && hostPorts().projects.remoteOf(projectId)) return path;
  if (!existsSync(path) || !statSync(path).isDirectory())
    throw new Error(`项目目录不存在：${path}`);
  return path;
}

export const isRemoteSession = (meta: SessionRow) =>
  Boolean(meta.project_id && hostPorts().projects.remoteOf(meta.project_id));

export type ModelChoice =
  | { kind: 'none' }
  | {
      kind: 'unavailable';
      providerId: string;
      providerName: string | null;
      model: string;
      effort: string | null;
    }
  | { kind: 'ready'; selection: SessionModel; effortLevels: string[]; stored: boolean };

function readyChoice(
  provider: StoredLlmProvider,
  model: string,
  effort: string | null,
  stored: boolean,
): ModelChoice {
  const settings = llmModelSettings(provider, model);
  const valid = effort && settings.effortLevels.includes(effort) ? effort : null;
  return {
    kind: 'ready',
    selection: { provider, model, effort: valid ?? settings.effort ?? null },
    effortLevels: settings.effortLevels,
    stored,
  };
}

export function modelChoice(meta: SessionRow): ModelChoice {
  const providers = llmProviders();
  const usable = usableLlmProviders(providers);
  if (meta.provider_id && meta.model) {
    const provider = usable.find(({ id }) => id === meta.provider_id);
    if (provider?.models.includes(meta.model))
      return readyChoice(provider, meta.model, meta.effort, true);
    return {
      kind: 'unavailable',
      providerId: meta.provider_id,
      providerName: providers.find(({ id }) => id === meta.provider_id)?.name ?? null,
      model: meta.model,
      effort: meta.effort,
    };
  }
  return defaultModelChoice(usable);
}

export function defaultModelChoice(usable = usableLlmProviders()): ModelChoice {
  const recent = hostPorts()
    .database()
    .prepare(
      'SELECT provider_id, model, effort FROM sessions WHERE message_count > 0 AND provider_id IS NOT NULL ORDER BY updated_at DESC LIMIT 1',
    )
    .get() as Pick<SessionRow, 'provider_id' | 'model' | 'effort'> | undefined;
  const inherited = recent && usable.find(({ id }) => id === recent.provider_id);
  if (inherited && recent.model && inherited.models.includes(recent.model))
    return readyChoice(inherited, recent.model, recent.effort, false);
  const first = usable[0];
  return first ? readyChoice(first, first.models[0]!, null, false) : { kind: 'none' };
}

export function readySelection(meta: SessionRow): Extract<ModelChoice, { kind: 'ready' }> {
  const choice = modelChoice(meta);
  if (choice.kind === 'none') throw new Error('请先在设置中配置模型服务');
  if (choice.kind === 'unavailable')
    throw new Error('这个会话的模型已停用或被移除，请在输入框里另选模型');
  return choice;
}

export function storeModel(id: string, providerId: string, model: string, effort: string | null) {
  hostPorts()
    .database()
    .prepare('UPDATE sessions SET provider_id=?, model=?, effort=? WHERE id=?')
    .run(providerId, model, effort, id);
}

export function storeSessionFile(id: string, file: string) {
  hostPorts().database().prepare('UPDATE sessions SET file=? WHERE id=?').run(file, id);
}

export function storeTitle(id: string, title: string, temporary = false) {
  hostPorts()
    .database()
    .prepare('UPDATE sessions SET title=?, title_temporary=? WHERE id=?')
    .run(title.slice(0, 60), Number(temporary), id);
}

export function completeTemporaryTitle(id: string, title: string) {
  return hostPorts()
    .database()
    .prepare(
      'UPDATE sessions SET title=?, title_temporary=0 WHERE id=? AND title_temporary=1 AND archived=0 RETURNING title',
    )
    .get(title.slice(0, 60), id) as { title: string } | undefined;
}

export function recentTemporaryTitleSessions(excludeId: string): { id: string }[] {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  return hostPorts()
    .database()
    .prepare(
      `SELECT id FROM sessions WHERE archived=0 AND parent_id IS NULL AND message_count>0
       AND title_temporary=1 AND updated_at>=? AND id<>? ORDER BY updated_at DESC`,
    )
    .all(since, excludeId) as { id: string }[];
}

export function storeActivity(id: string, messageCount: number) {
  hostPorts()
    .database()
    .prepare('UPDATE sessions SET message_count=?, updated_at=? WHERE id=?')
    .run(messageCount, new Date().toISOString(), id);
}

export function storeVisibility(id: string, patch: { archived?: boolean; pinned?: boolean }) {
  const db = hostPorts().database();
  if (patch.archived !== undefined)
    db.prepare('UPDATE sessions SET archived=? WHERE id=? OR parent_id=?').run(
      Number(patch.archived),
      id,
      id,
    );
  if (patch.pinned !== undefined)
    db.prepare('UPDATE sessions SET pinned=? WHERE id=?').run(Number(patch.pinned), id);
}

export function storeProject(id: string, projectId: string | null) {
  const db = hostPorts().database();
  const cwd = projectId === null ? chatSessionDirectory(id) : null;
  db.transaction(() => {
    db.prepare('UPDATE sessions SET project_id=?, cwd=? WHERE id=?').run(projectId, cwd, id);
    db.prepare('UPDATE sessions SET project_id=?, cwd=NULL WHERE parent_id=?').run(projectId, id);
    db.prepare('DELETE FROM workspace_settings WHERE key=?').run(permissionKey(id));
  })();
}

export function modelAutoCompaction(providerId: string, modelId: string): number | undefined {
  const setting = hostPorts()
    .database()
    .prepare('SELECT value FROM workspace_settings WHERE key=?')
    .get(`model-autocompact:${providerId}:${modelId}`) as { value: string } | undefined;
  return setting ? Number(setting.value) : undefined;
}

export function storeModelAutoCompaction(
  providerId: string,
  modelId: string,
  tokens: number | null,
) {
  const db = hostPorts().database();
  const key = `model-autocompact:${providerId}:${modelId}`;
  if (tokens === null) db.prepare('DELETE FROM workspace_settings WHERE key=?').run(key);
  else
    db.prepare('INSERT OR REPLACE INTO workspace_settings VALUES (?, ?)').run(key, String(tokens));
}

export type LocalCommandReply = { input: string; reply: string; sentAt: number; repliedAt: number };

export function localCommandReplies(id: string): LocalCommandReply[] {
  const setting = hostPorts()
    .database()
    .prepare('SELECT value FROM workspace_settings WHERE key=?')
    .get(`session-commands:${id}`) as { value: string } | undefined;
  return setting ? (JSON.parse(setting.value) as LocalCommandReply[]) : [];
}

export function storeLocalCommandReply(id: string, reply: LocalCommandReply): LocalCommandReply[] {
  const replies = [...localCommandReplies(id), reply];
  const db = hostPorts().database();
  db.transaction(() => {
    db.prepare('INSERT OR REPLACE INTO workspace_settings VALUES (?, ?)').run(
      `session-commands:${id}`,
      JSON.stringify(replies),
    );
    db.prepare('UPDATE sessions SET updated_at=? WHERE id=?').run(
      new Date(reply.repliedAt).toISOString(),
      id,
    );
  })();
  return replies;
}

export function archiveProject(projectId: string | null): string[] {
  const db = hostPorts().database();
  const ids = db
    .prepare('SELECT id FROM sessions WHERE project_id IS ? AND archived = 0')
    .all(projectId) as { id: string }[];
  db.prepare('UPDATE sessions SET archived=1 WHERE project_id IS ?').run(projectId);
  return ids.map(({ id }) => id);
}

export const childSessionIds = (id: string) =>
  (
    hostPorts().database().prepare('SELECT id FROM sessions WHERE parent_id=?').all(id) as {
      id: string;
    }[]
  ).map((child) => child.id);

export function removeSession(id: string) {
  const db = hostPorts().database();
  db.transaction(() => {
    db.prepare('DELETE FROM sessions WHERE id=?').run(id);
    db.prepare('DELETE FROM workspace_settings WHERE key IN (?, ?, ?)').run(
      `session-commands:${id}`,
      `session-autocompact:${id}`,
      permissionKey(id),
    );
  })();
}

const summaryColumns =
  'id, title, pinned, project_id AS projectId, updated_at AS updatedAt, created_at AS createdAt';
type SummaryRow = Omit<ChatSessionSummary, 'pinned'> & { pinned: number };
const toSummary = (row: SummaryRow): ChatSessionSummary => ({ ...row, pinned: row.pinned === 1 });

export function listSessions(
  projectId: string | null,
  query: string,
  includeLocal = false,
): ChatSessionSummary[] {
  const pattern = `%${query.replace(/[\\%_]/g, '\\$&')}%`;
  return hostPorts()
    .database()
    .prepare(
      `SELECT ${summaryColumns} FROM sessions WHERE project_id IS ? AND archived = 0 AND parent_id IS NULL
       AND (message_count > 0 ${includeLocal ? "OR EXISTS (SELECT 1 FROM workspace_settings WHERE key='session-commands:' || sessions.id)" : ''})
       ${query ? "AND title LIKE ? ESCAPE '\\'" : ''} ORDER BY pinned DESC, updated_at DESC LIMIT 100`,
    )
    .all(...(query ? [projectId, pattern] : [projectId]))
    .map((row) => toSummary(row as SummaryRow));
}

export function archivedSessions(): ChatSessionSummary[] {
  return hostPorts()
    .database()
    .prepare(
      `SELECT ${summaryColumns} FROM sessions WHERE archived = 1 AND parent_id IS NULL ORDER BY updated_at DESC`,
    )
    .all()
    .map((row) => toSummary(row as SummaryRow));
}

function emptyGeneralSessionId(): string | undefined {
  const privateRoot = join(hostPorts().paths.storage(), 'chat-sessions', sep);
  const row = hostPorts()
    .database()
    .prepare(
      `SELECT id FROM sessions WHERE project_id IS NULL AND archived = 0 AND message_count = 0
       AND parent_id IS NULL AND substr(cwd, 1, ?) = ?
       AND NOT EXISTS (SELECT 1 FROM workspace_settings WHERE key='session-commands:' || sessions.id)
       ORDER BY updated_at DESC LIMIT 1`,
    )
    .get(privateRoot.length, privateRoot) as { id: string } | undefined;
  return row?.id;
}

export function emptySessionId(projectId: string | null): string | undefined {
  if (projectId === null) return emptyGeneralSessionId();
  return (
    hostPorts()
      .database()
      .prepare(
        `SELECT id FROM sessions WHERE project_id IS ? AND archived = 0 AND message_count = 0
         AND parent_id IS NULL AND NOT EXISTS (SELECT 1 FROM workspace_settings WHERE key='session-commands:' || sessions.id)
         ORDER BY updated_at DESC LIMIT 1`,
      )
      .get(projectId) as { id: string } | undefined
  )?.id;
}

export function insertSession(projectId: string | null): string {
  const id = randomUUID();
  const cwd = projectId !== null ? null : ensurePrivateSession(id);
  const now = new Date().toISOString();
  hostPorts()
    .database()
    .prepare(
      'INSERT INTO sessions (id, project_id, cwd, file, title_temporary, created_at, updated_at) VALUES (?, ?, ?, ?, 1, ?, ?)',
    )
    .run(id, projectId, cwd, '', now, now);
  return id;
}

export function adoptSessionFile(meta: SessionRow, file: string, titlePrefix: string): string {
  const id = randomUUID();
  const userMessages = requirePiSync()
    .SessionManager.open(file)
    .buildSessionContext()
    .messages.filter((message) => message.role === 'user').length;
  const now = new Date().toISOString();
  hostPorts()
    .database()
    .prepare(
      `INSERT INTO sessions (id, project_id, cwd, file, title, message_count, provider_id, model, effort, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      meta.project_id,
      meta.project_id === null ? ensurePrivateSession(id) : null,
      file,
      `${titlePrefix}${meta.title}`.slice(0, 60),
      userMessages,
      meta.provider_id,
      meta.model,
      meta.effort,
      now,
      now,
    );
  return id;
}

export function insertSubagentSession(parentId: string, description: string, cwd: string): string {
  const parent = row(parentId);
  const id = randomUUID();
  const now = new Date().toISOString();
  hostPorts()
    .database()
    .prepare(
      `INSERT INTO sessions (id, project_id, cwd, file, title, provider_id, model, effort, parent_id, created_at, updated_at)
       VALUES (?, ?, ?, '', ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      parent.project_id,
      cwd,
      description.slice(0, 60),
      parent.provider_id,
      parent.model,
      parent.effort,
      parentId,
      now,
      now,
    );
  return id;
}

let piSync: typeof import('@earendil-works/pi-coding-agent') | undefined;
export function requirePiSync() {
  if (!piSync) throw new Error('Pi 尚未加载');
  return piSync;
}
export async function preloadPi() {
  if (piSync) return;
  const { loadPi } = await import('../pi');
  piSync = await loadPi();
}
