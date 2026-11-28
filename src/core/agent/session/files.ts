import { hostPorts } from '../../ports';
import * as changes from '../changes';
import { chatFileHistory, chatFileKey, readChatFileVersion } from '../chat-files';
import { executionMode } from '../sandbox/mode';
import { scopedReferencePath } from '../sandbox/scoped-files';
import { resolveSessionFile } from '../session-path';
import { sessionRunning } from './live';
import { isRemoteSession, row, sessionCwd } from './store';

const chatVirtualPath = /^\/(privacy|share)(\/|$)/;

function sessionFilePath(sessionId: string, rawPath: string): string {
  const meta = row(sessionId);
  if (isRemoteSession(meta)) throw new Error('远程项目的文件不在本机，请用远端方式打开');
  if (executionMode(meta) !== 'full' || (meta.project_id === null && chatVirtualPath.test(rawPath)))
    return scopedReferencePath(meta, rawPath);
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

const sessionTitle = (id: string) => {
  try {
    return row(id).title;
  } catch {
    return null;
  }
};

export async function chatFileTimeline(file: string) {
  const key = chatFileKey(file);
  if (!key || sessionTitle(key.sessionId) === null) return null;
  const history = await chatFileHistory(key.sessionId, key.path, !sessionRunning(key.sessionId));
  return {
    sessionId: key.sessionId,
    path: key.path,
    entries: history.toReversed().map(({ event, change }) => ({
      eventId: event.id,
      at: event.at,
      status: !change.before
        ? ('added' as const)
        : !change.after
          ? ('deleted' as const)
          : ('modified' as const),
      source:
        event.source.kind === 'turn' || event.source.kind === 'branch'
          ? {
              kind: event.source.kind,
              sessionId: event.source.sessionId,
              title: sessionTitle(event.source.sessionId),
            }
          : { kind: event.source.kind },
    })),
  };
}

export function readChatFileVersionChange(sessionId: string, eventId: string, path: string) {
  row(sessionId);
  return readChatFileVersion(sessionId, eventId, path);
}
