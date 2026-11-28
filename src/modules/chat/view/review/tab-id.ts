import type { TabId } from '../../../../app/module';

export type ReviewTabTarget =
  | { kind: 'turn'; sessionId: string; turnId: string; path: string }
  | { kind: 'version'; sessionId: string; eventId: string; path: string }
  | { kind: 'uncommitted'; projectId: string; path: string };

const TURN_PAYLOAD = /^([0-9a-f-]{36}):([0-9a-f-]{36}):([\s\S]+)$/;
const VERSION_PAYLOAD = /^([0-9a-f-]{36}):version:([0-9a-f-]{36}):([\s\S]+)$/;
const UNCOMMITTED_PAYLOAD = /^([0-9a-f-]{36}):uncommitted:([\s\S]+)$/;

export function reviewTabId(target: ReviewTabTarget): TabId {
  if (target.kind === 'turn') return `review:${target.sessionId}:${target.turnId}:${target.path}`;
  if (target.kind === 'version')
    return `review:${target.sessionId}:version:${target.eventId}:${target.path}`;
  return `review:${target.projectId}:uncommitted:${target.path}`;
}

export function parseReviewTabId(tabId: string): ReviewTabTarget | null {
  if (!tabId.startsWith('review:')) return null;
  const payload = tabId.slice('review:'.length);
  const turn = TURN_PAYLOAD.exec(payload);
  if (turn) return { kind: 'turn', sessionId: turn[1]!, turnId: turn[2]!, path: turn[3]! };
  const version = VERSION_PAYLOAD.exec(payload);
  if (version)
    return { kind: 'version', sessionId: version[1]!, eventId: version[2]!, path: version[3]! };
  const uncommitted = UNCOMMITTED_PAYLOAD.exec(payload);
  return uncommitted
    ? { kind: 'uncommitted', projectId: uncommitted[1]!, path: uncommitted[2]! }
    : null;
}

export function reviewTabTitle(tabId: TabId): string {
  const target = parseReviewTabId(tabId);
  if (!target) return '改动审阅';
  const cut = Math.max(target.path.lastIndexOf('/'), target.path.lastIndexOf('\\'));
  return cut >= 0 ? target.path.slice(cut + 1) : target.path;
}
