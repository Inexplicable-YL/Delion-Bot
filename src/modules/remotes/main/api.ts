import { randomUUID } from 'node:crypto';
import { hostPorts } from '../../../core/ports';
import type {
  RemoteBrowseResult,
  RemoteConnection,
  RemoteDraft,
  RemotePrepare,
  RemoteProbe,
  RemoteSetupProgress,
  SshConfigHost,
} from '../contract';
import { remoteDraftSchema, withinRemotePath } from '../contract';
import { prepareHelper } from '../../../core/remote/helper';
import { locateRemote, makeRemoteDirectory } from '../../../core/remote/operations';
import { sshConfigHosts } from './ssh-config';
import { probeRemote, type RemoteTarget } from '../../../core/remote/transport';

interface RemoteRow {
  id: string;
  label: string;
  host: string;
  port: number | null;
  key_path: string | null;
  created_at: string;
}

const fromRow = (row: RemoteRow): RemoteConnection => ({
  id: row.id,
  label: row.label,
  host: row.host,
  port: row.port,
  keyPath: row.key_path,
  createdAt: row.created_at,
});

export function listRemotes(): RemoteConnection[] {
  const rows = hostPorts()
    .database()
    .prepare('SELECT * FROM remotes ORDER BY created_at')
    .all() as RemoteRow[];
  return rows.map(fromRow);
}

export function remoteById(id: string): RemoteConnection {
  const row = hostPorts().database().prepare('SELECT * FROM remotes WHERE id=?').get(id) as
    RemoteRow | undefined;
  if (!row) throw new Error('远程连接不存在');
  return fromRow(row);
}

export function targetOf(draft: RemoteDraft): RemoteTarget {
  return { host: draft.host, port: draft.port ?? null, keyPath: draft.keyPath ?? null };
}

export function saveRemote(draft: RemoteDraft & { id?: string | null }): RemoteConnection {
  const parsed = remoteDraftSchema.parse(draft);
  const label = parsed.label?.trim() || parsed.host;
  const database = hostPorts().database();
  if (draft.id) {
    remoteById(draft.id);
    database
      .prepare('UPDATE remotes SET label=?, host=?, port=?, key_path=? WHERE id=?')
      .run(label, parsed.host, parsed.port ?? null, parsed.keyPath ?? null, draft.id);
    return remoteById(draft.id);
  }
  const id = randomUUID();
  database
    .prepare(
      'INSERT INTO remotes (id, label, host, port, key_path, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    )
    .run(
      id,
      label,
      parsed.host,
      parsed.port ?? null,
      parsed.keyPath ?? null,
      new Date().toISOString(),
    );
  return remoteById(id);
}

export async function removeRemote(id: string): Promise<void> {
  remoteById(id);
  const projects = hostPorts()
    .database()
    .prepare(`SELECT id FROM workspace_entries WHERE remote_id=? AND kind='project'`)
    .all(id) as { id: string }[];
  if (projects.length) {
    const { removeWorkspaceEntry } = await import('../../workspace');
    for (const project of projects) await removeWorkspaceEntry(project.id);
  }
  hostPorts().database().prepare('DELETE FROM remotes WHERE id=?').run(id);
}

export function configHostCandidates(): SshConfigHost[] {
  const saved = new Set(listRemotes().map((connection) => connection.host));
  return sshConfigHosts().filter((host) => !saved.has(host.alias));
}

export async function probeConnection(draft: RemoteDraft): Promise<RemoteProbe> {
  const parsed = remoteDraftSchema.parse(draft);
  try {
    const probe = await probeRemote(targetOf(parsed));
    return { ok: true, message: `${probe.hostname} · ${probe.system} ${probe.machine}` };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) };
  }
}

export async function prepareRemote(
  draft: RemoteDraft,
  onProgress?: (progress: RemoteSetupProgress) => void,
): Promise<RemotePrepare> {
  const parsed = remoteDraftSchema.parse(draft);
  const { ok, failure, home } = await prepareHelper(targetOf(parsed), onProgress);
  if (!ok) return { ok: false, message: failure ?? '未知原因', home: null };
  onProgress?.({ step: 'ready', ok: true, detail: 'helper 通道已就绪' });
  return { ok: true, message: '', home };
}

export async function createRemoteDirectory(
  draft: RemoteDraft,
  parent: string,
  name: string,
): Promise<string> {
  const path = remoteJoin(parent.replace(/\/+$/, '') || '/', name);
  await makeRemoteDirectory(targetOf(remoteDraftSchema.parse(draft)), path);
  return path;
}

export function parentOf(path: string): string | null {
  const trimmed = path.replace(/\/+$/, '');
  if (!trimmed || trimmed === '/') return null;
  const cut = trimmed.lastIndexOf('/');
  return cut <= 0 ? '/' : trimmed.slice(0, cut);
}

export function remoteJoin(directory: string, name: string): string {
  return directory.endsWith('/') ? `${directory}${name}` : `${directory}/${name}`;
}

export const withinRemoteRoot = withinRemotePath;

export async function browseRemote(draft: RemoteDraft, path: string): Promise<RemoteBrowseResult> {
  const target = targetOf(remoteDraftSchema.parse(draft));
  const wanted = path.replace(/\/+$/, '') || '/';
  const location = await locateRemote(target, wanted);
  if (location.kind !== 'directory')
    throw new Error(`${wanted} 不是目录：请选择一个远端目录作为项目位置`);
  const directories = (location.entries ?? [])
    .filter((entry) => entry.directory)
    .map((entry) => ({
      name: entry.name,
      path: remoteJoin(wanted, entry.name),
      directory: true,
      size: null,
      modifiedAt: entry.modifiedAt,
    }))
    .sort((left, right) => left.name.localeCompare(right.name));
  return { path: wanted, parent: parentOf(wanted), directories };
}
