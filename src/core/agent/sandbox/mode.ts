import { mkdirSync, realpathSync, statSync } from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { hostPorts } from '../../ports';
import type { PermissionMode } from '../../protocol/agent';
import type { RemoteTarget } from '../../remote/transport';
import {
  chatSessionDirectory,
  chatShareDirectory,
  readPermissionMode,
  row,
  sessionCwd,
  type SessionRow,
} from '../session/store';
export type ExecutionMode = PermissionMode;

export interface ScopedDirectory {
  name: '/privacy' | '/share' | '/project';
  host: string;
  remote?: RemoteTarget;
}

export interface LaunchPlan {
  mode: ExecutionMode;
  piCwd: string;
  hostCwd: string;
}

export function ownerRow(meta: SessionRow): SessionRow {
  return meta.parent_id ? row(meta.parent_id) : meta;
}

export function executionMode(meta: SessionRow): ExecutionMode {
  const owner = ownerRow(meta);
  const mode = readPermissionMode(owner.id);
  return mode === 'project-write' && !owner.project_id ? 'read-only' : mode;
}

export function launchPlan(meta: SessionRow): LaunchPlan {
  const mode = executionMode(meta);
  if (mode === 'full') {
    const hostCwd = sessionCwd(meta.project_id, meta.cwd);
    return { mode, piCwd: hostCwd, hostCwd };
  }
  const owner = ownerRow(meta);
  const hostCwd = owner.project_id
    ? sessionCwd(owner.project_id, null)
    : chatSessionDirectory(owner.id);
  return { mode, piCwd: owner.project_id ? '/project' : '/privacy', hostCwd };
}

function covers(parent: string, child: string): boolean {
  const rel = relative(parent, child);
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}

function resolvedPath(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return resolve(path);
  }
}

export function scopedDirectories(meta: SessionRow): ScopedDirectory[] {
  const owner = ownerRow(meta);
  const { paths, projects } = hostPorts();
  const remote = owner.project_id ? projects.remoteOf(owner.project_id) : null;
  if (remote) return [{ name: '/project', host: remote.path, remote: remote.target }];
  mkdirSync(paths.storage(), { recursive: true });
  const storage = realpathSync(paths.storage());
  const application = resolvedPath(paths.applicationCode?.() ?? paths.bundled('scopedfs'));
  const blocked = [
    application,
    paths.userData(),
    join(storage, 'chat-sessions'),
    join(storage, 'chat-share'),
    join(paths.home(), '.delion-bot'),
    join(paths.temp(), 'delion-document-reading'),
    ...(process.platform === 'linux' ? ['/dev', '/proc', '/sys', '/run'] : []),
    ...(process.platform === 'darwin' ? ['/dev', '/System'] : []),
  ].map(resolvedPath);
  if (owner.project_id) {
    const host = realpathSync(sessionCwd(owner.project_id, null));
    if (blocked.some((path) => covers(path, host) || covers(host, path))) return [];
    return [{ name: '/project', host }];
  }
  return [
    { name: '/privacy' as const, path: chatSessionDirectory(owner.id), directory: 'chat-sessions' },
    { name: '/share' as const, path: chatShareDirectory(owner.id), directory: 'chat-share' },
  ].map(({ name, path, directory }) => {
    const host = realpathSync(path);
    if (
      relative(host, join(storage, directory, owner.id)) !== '' ||
      !statSync(host).isDirectory() ||
      covers(application, host) ||
      covers(host, application)
    )
      throw new Error('聊天文件目录不可用');
    return { name, host };
  });
}
