import { hostPorts } from '../../ports';
import * as changes from '../changes';
import { executionMode, sandboxRoots } from '../sandbox/mode';
import { restrictedLocalPath } from '../sandbox/paths';
import { resolveSessionFile } from '../session-path';
import { isRemoteSession, row, sessionCwd } from './store';

function sessionFilePath(sessionId: string, rawPath: string): string {
  const meta = row(sessionId);
  if (isRemoteSession(meta)) throw new Error('远程项目的文件不在本机，请用远端方式打开');
  if (executionMode(meta) === 'restricted') {
    const roots = sandboxRoots(meta.parent_id ?? meta.id);
    return restrictedLocalPath(
      rawPath,
      { privacy: roots.privacyHost, delivery: roots.deliveryHost },
      roots.conceal,
    );
  }
  return resolveSessionFile(sessionCwd(meta.project_id, meta.cwd), rawPath);
}

export function revealSessionFile(sessionId: string, path: string): void {
  hostPorts().desktop.reveal(sessionFilePath(sessionId, path));
}

export async function openSessionFile(sessionId: string, path: string): Promise<void> {
  await hostPorts().desktop.open(sessionFilePath(sessionId, path));
}

export function locateSessionFile(sessionId: string, path: string): string {
  return sessionFilePath(sessionId, path);
}

export function listSessionTurnChanges(id: string) {
  row(id);
  return changes.listTurnChanges(id);
}

export function readSessionTurnChanges(id: string, turnId: string, includeStats = false) {
  row(id);
  return changes.readTurnChanges(id, turnId, includeStats);
}

export function readSessionTurnFileChange(id: string, turnId: string, path: string) {
  row(id);
  return changes.readTurnFileChange(id, turnId, path);
}
