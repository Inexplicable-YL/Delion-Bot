import { join } from 'node:path';
import { hostPorts } from '../../ports';
import {
  chatDeliveryDirectory,
  ensurePrivateSession,
  readPermissionMode,
  row,
  sessionCwd,
  type SessionRow,
} from '../session/store';
export type ExecutionMode = 'project' | 'restricted' | 'full';

export interface SandboxRoots {
  ownerId: string;
  privacyHost: string;
  deliveryHost: string;
  conceal: readonly string[];
}

export interface LaunchPlan {
  mode: ExecutionMode;
  piCwd: string;
  hostCwd: string;
  roots: SandboxRoots | null;
}

export function ownerRow(meta: SessionRow): SessionRow {
  return meta.parent_id ? row(meta.parent_id) : meta;
}

export function executionMode(meta: SessionRow): ExecutionMode {
  const owner = ownerRow(meta);
  if (owner.project_id) return 'project';
  return readPermissionMode(owner.id) === 'full' ? 'full' : 'restricted';
}

export function sandboxRoots(ownerId: string): SandboxRoots {
  const privacyHost = ensurePrivateSession(ownerId);
  const deliveryHost = chatDeliveryDirectory(ownerId);
  return {
    ownerId,
    privacyHost,
    deliveryHost,
    conceal: [
      ownerId,
      privacyHost,
      deliveryHost,
      hostPorts().paths.userData(),
      join(hostPorts().paths.storage(), 'chat-sessions'),
      join(hostPorts().paths.storage(), 'chat-delivery'),
    ],
  };
}

export function launchPlan(meta: SessionRow): LaunchPlan {
  const mode = executionMode(meta);
  if (mode !== 'restricted') {
    const hostCwd = sessionCwd(meta.project_id, meta.cwd);
    return { mode, piCwd: hostCwd, hostCwd, roots: null };
  }
  const owner = ownerRow(meta);
  const roots = sandboxRoots(owner.id);
  const hostCwd = meta.parent_id ? (meta.cwd ?? roots.privacyHost) : roots.privacyHost;
  return { mode, piCwd: '/privacy', hostCwd, roots };
}
