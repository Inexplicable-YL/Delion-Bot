import { mkdirSync, realpathSync, statSync } from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { hostPorts } from '../../ports';
import type { PermissionMode } from '../../protocol/agent';
import {
  chatSessionDirectory,
  chatShareDirectory,
  ensurePrivateSession,
  readPermissionMode,
  row,
  sessionCwd,
  type SessionRow,
} from '../session/store';
export type ExecutionMode = PermissionMode;

export interface ScopedDirectory {
  name: '/privacy' | '/share' | '/project';
  host: string;
}

export interface SandboxRoots {
  ownerId: string;
  privacyHost: string;
  shareHost: string;
  conceal: readonly string[];
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

export function sandboxRoots(ownerId: string): SandboxRoots {
  const privacyHost = ensurePrivateSession(ownerId);
  const shareHost = chatShareDirectory(ownerId);
  return {
    ownerId,
    privacyHost,
    shareHost,
    conceal: [
      ownerId,
      privacyHost,
      shareHost,
      hostPorts().paths.userData(),
      join(hostPorts().paths.storage(), 'chat-sessions'),
      join(hostPorts().paths.storage(), 'chat-share'),
    ],
  };
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

export function scopedDirectories(meta: SessionRow): ScopedDirectory[] {
  const owner = ownerRow(meta);
  const { paths, projects } = hostPorts();
  if (owner.project_id && projects.remoteOf(owner.project_id)) return [];
  mkdirSync(paths.storage(), { recursive: true });
  const storage = realpathSync(paths.storage());
  const blocked = [
    paths.userData(),
    join(storage, 'chat-sessions'),
    join(storage, 'chat-share'),
    join(paths.home(), '.delion-bot'),
    join(paths.temp(), 'delion-document-reading'),
  ].map((path) => {
    try {
      return realpathSync(path);
    } catch {
      return resolve(path);
    }
  });
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
    if (relative(host, join(storage, directory, owner.id)) !== '' || !statSync(host).isDirectory())
      throw new Error('聊天文件目录不可用');
    return { name, host };
  });
}
