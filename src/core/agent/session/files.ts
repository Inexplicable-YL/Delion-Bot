import { hostPorts } from '../../ports';
import * as changes from '../changes';
import {
  chatFileHistory,
  chatFileKey,
  readChatFileVersion,
  type ChangeSource,
} from '../chat-files';
import { virtualChatText } from '../chat-paths';
import { executionMode } from '../sandbox/mode';
import { scopedReferencePath } from '../sandbox/scoped-files';
import { resolveSessionFile } from '../session-path';
import { isRemoteSession, row, sessionCwd, type SessionRow } from './store';

const chatVirtualPath = /^\/(privacy|share)(\/|$)/;

export function chatReferencePath(meta: SessionRow, rawPath: string): string | null {
  if (meta.project_id !== null) return null;
  const path = virtualChatText(rawPath);
  return chatVirtualPath.test(path) ? scopedReferencePath(meta, path) : null;
}

function sessionFilePath(sessionId: string, rawPath: string): string {
  const meta = row(sessionId);
  if (isRemoteSession(meta)) throw new Error('远程项目的文件不在本机，请用远端方式打开');
  const chatPath = chatReferencePath(meta, rawPath);
  if (chatPath) return chatPath;
  if (executionMode(meta) !== 'full') return scopedReferencePath(meta, rawPath);
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

function timelineSource(source: ChangeSource) {
  switch (source.kind) {
    case 'user':
      return { kind: 'user' as const };
    case 'agent':
    case 'branch':
      return {
        kind: source.kind,
        sessionId: source.sessionId,
        title: sessionTitle(source.sessionId),
      };
    default:
      return { kind: 'revert' as const };
  }
}

export async function chatFileTimeline(file: string) {
  const key = chatFileKey(file);
  if (!key || sessionTitle(key.sessionId) === null) return null;
  const history = await chatFileHistory(key.sessionId, key.path);
  return {
    sessionId: key.sessionId,
    path: key.path,
    entries: history.toReversed().map(({ from, to, first, last }) => ({
      fromEventId: from.id,
      toEventId: to.id,
      at: to.at,
      status: !first.before
        ? ('added' as const)
        : !last.after
          ? ('deleted' as const)
          : ('modified' as const),
      source: timelineSource(to.source),
    })),
  };
}

export function readChatFileVersionChange(
  sessionId: string,
  fromEventId: string,
  toEventId: string,
  path: string,
) {
  row(sessionId);
  return readChatFileVersion(sessionId, fromEventId, toEventId, path);
}
