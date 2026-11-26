import { createHash, randomUUID } from 'node:crypto';
import { row } from '../../../core/agent/session/store';
import {
  emit,
  hostPorts,
  type Approval,
  type ApprovalGrant,
  type ApprovalRequest,
} from '../../../core/ports';
import { systemNotifyToast } from '../../notifications';
import { chatContract, type PermissionDecision, type PermissionRequest } from '../contract';

type Decision = { decision: PermissionDecision; note?: string };
type Resolution = Decision | { decision: 'grant'; note?: never };
type GrantTarget = { scope: 'session' | 'project'; id: string };

const pending = new Map<
  string,
  {
    sessionId: string;
    request: PermissionRequest;
    grant?: ApprovalGrant & { target: GrantTarget };
    decide: (decision: Resolution) => boolean;
  }
>();
const sessionGrants = new Map<string, Set<string>>();
const projectGrantsKey = (projectId: string) => `project-permission-grants:${projectId}`;

function grantedKeys({ scope, id }: GrantTarget): Set<string> {
  if (scope === 'session') return sessionGrants.get(id) ?? new Set();
  const stored = hostPorts()
    .database()
    .prepare('SELECT value FROM workspace_settings WHERE key=?')
    .get(projectGrantsKey(id)) as { value: string } | undefined;
  return new Set(stored ? (JSON.parse(stored.value) as string[]) : []);
}

function saveGrant(target: GrantTarget, keys: string[]) {
  const granted = new Set([...grantedKeys(target), ...keys]);
  if (target.scope === 'session') sessionGrants.set(target.id, granted);
  else
    hostPorts()
      .database()
      .prepare('INSERT OR REPLACE INTO workspace_settings VALUES (?, ?)')
      .run(projectGrantsKey(target.id), JSON.stringify([...granted]));
}

function covers(target: GrantTarget, grant: ApprovalGrant): boolean {
  const granted = grantedKeys(target);
  return (
    grant.keys.every((key) => granted.has(key)) ||
    (grant.directory !== undefined && granted.has(grant.directory.key))
  );
}

export function permissionRequests(sessionId: string): PermissionRequest[] {
  return [...pending.values()]
    .filter((entry) => entry.sessionId === sessionId)
    .map(({ request }) => request);
}

export function decidePermissionRequest(input: { sessionId: string; id: string } & Decision) {
  const entry = pending.get(input.id);
  if (!entry || entry.sessionId !== input.sessionId) return false;
  if (!entry.decide(input)) return false;
  if ((input.decision !== 'always' && input.decision !== 'directory') || !entry.grant) return true;
  const { target } = entry.grant;
  for (const other of [...pending.values()])
    if (
      other.grant?.target.scope === target.scope &&
      other.grant.target.id === target.id &&
      covers(target, other.grant)
    )
      other.decide({ decision: 'grant' });
  return true;
}

export function requestChatPermission(
  sessionId: string,
  input: Omit<PermissionRequest, 'id' | 'grant'> & {
    capability: ApprovalRequest['kind'];
    grant?: ApprovalGrant;
  },
  signal: AbortSignal,
): Promise<Approval> {
  const { capability, grant, ...request } = input;
  const session = row(sessionId);
  const projectId = session.project_id;
  const target: GrantTarget | undefined =
    grant &&
    (projectId ? { scope: 'project', id: projectId } : { scope: 'session', id: sessionId });
  const id = randomUUID();
  const db = hostPorts().database();
  const record = (decision: PermissionDecision | 'cancelled', keys = grant?.keys ?? []) =>
    db
      .prepare(
        `INSERT INTO permission_decisions
        (request_id, session_id, project_id, capability, title, decision, scope, grant_fingerprints, decided_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        sessionId,
        projectId,
        capability,
        request.title,
        decision,
        target?.scope ?? 'once',
        JSON.stringify(keys.map((key) => createHash('sha256').update(key).digest('hex'))),
        new Date().toISOString(),
      );
  if (signal.aborted) {
    record('cancelled');
    return Promise.resolve({ approved: false });
  }
  if (grant && target && covers(target, grant)) return Promise.resolve({ approved: true });
  const waiting = permissionRequests(sessionId).length > 0;
  return new Promise((resolve, reject) => {
    const notify = () =>
      emit(chatContract, 'permissionRequestsChanged', {
        sessionId,
        requests: permissionRequests(sessionId),
      });
    const abort = () => decide({ decision: 'deny' });
    const decide = (resolution: Resolution) => {
      const { decision, note } = resolution;
      const outcome = signal.aborted ? 'cancelled' : decision;
      const savedKeys =
        outcome === 'always'
          ? grant?.keys
          : outcome === 'directory' && grant?.directory
            ? [grant.directory.key]
            : undefined;
      if ((outcome === 'always' || outcome === 'directory') && !savedKeys) return false;
      pending.delete(id);
      signal.removeEventListener('abort', abort);
      try {
        if (outcome === 'grant') {
          resolve({ approved: true });
          return true;
        }
        if (savedKeys && target?.scope === 'project') {
          db.transaction(() => {
            record(outcome, savedKeys);
            saveGrant(target, savedKeys);
          })();
        } else {
          record(outcome, savedKeys);
          if (savedKeys && target) saveGrant(target, savedKeys);
        }
        resolve(
          outcome === 'deny' || outcome === 'cancelled'
            ? { approved: false, ...(note && { note }) }
            : { approved: true },
        );
        return true;
      } catch (error) {
        reject(error);
        return false;
      } finally {
        notify();
      }
    };
    pending.set(id, {
      sessionId,
      request: {
        id,
        ...request,
        ...(grant &&
          target && {
            grant: {
              label: grant.label,
              scope: target.scope,
              ...(grant.directory && { directoryLabel: grant.directory.label }),
            },
          }),
      },
      ...(grant && target && { grant: { ...grant, target } }),
      decide,
    });
    signal.addEventListener('abort', abort, { once: true });
    notify();
    if (waiting) return;
    systemNotifyToast('需要你的审批', `${session.title} · ${request.title}`, () =>
      emit(chatContract, 'permissionRequestOpened', {
        sessionId,
        projectId: session.project_id,
      }),
    );
  });
}
