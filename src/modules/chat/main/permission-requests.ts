import { randomUUID } from 'node:crypto';
import { row } from '../../../core/agent/session/store';
import { emit, hostPorts, type Approval, type ApprovalGrant } from '../../../core/ports';
import { chatContract, type PermissionRequest } from '../contract';

type Decision = { decision: 'once' | 'always' | 'deny'; note?: string };
type GrantTarget = { scope: 'session' | 'project'; id: string };

const pending = new Map<
  string,
  {
    sessionId: string;
    request: PermissionRequest;
    grant?: { keys: string[]; target: GrantTarget };
    decide: (decision: Decision) => void;
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

const covers = (target: GrantTarget, keys: string[]) => {
  const granted = grantedKeys(target);
  return keys.every((key) => granted.has(key));
};

export function permissionRequests(sessionId: string): PermissionRequest[] {
  return [...pending.values()]
    .filter((entry) => entry.sessionId === sessionId)
    .map(({ request }) => request);
}

export function decidePermissionRequest(input: { sessionId: string; id: string } & Decision) {
  const entry = pending.get(input.id);
  if (!entry || entry.sessionId !== input.sessionId) return false;
  if (input.decision === 'always' && !entry.grant) return false;
  entry.decide(input);
  if (input.decision !== 'always' || !entry.grant) return true;
  const { target } = entry.grant;
  for (const other of [...pending.values()])
    if (
      other.grant?.target.scope === target.scope &&
      other.grant.target.id === target.id &&
      covers(target, other.grant.keys)
    )
      other.decide({ decision: 'once' });
  return true;
}

export function requestChatPermission(
  sessionId: string,
  input: Omit<PermissionRequest, 'id' | 'grant'> & { grant?: ApprovalGrant },
  signal: AbortSignal,
): Promise<Approval> {
  if (signal.aborted) return Promise.resolve({ approved: false });
  const { grant, ...request } = input;
  const projectId = grant && row(sessionId).project_id;
  const target: GrantTarget | undefined =
    grant &&
    (projectId ? { scope: 'project', id: projectId } : { scope: 'session', id: sessionId });
  if (grant && target && covers(target, grant.keys)) return Promise.resolve({ approved: true });
  const id = randomUUID();
  return new Promise((resolve) => {
    const notify = () =>
      emit(chatContract, 'permissionRequestsChanged', {
        sessionId,
        requests: permissionRequests(sessionId),
      });
    const abort = () => decide({ decision: 'deny' });
    const decide = ({ decision, note }: Decision) => {
      pending.delete(id);
      signal.removeEventListener('abort', abort);
      if (decision === 'always' && grant && target) saveGrant(target, grant.keys);
      resolve(
        decision !== 'deny' && !signal.aborted
          ? { approved: true }
          : { approved: false, ...(note && { note }) },
      );
      notify();
    };
    pending.set(id, {
      sessionId,
      request: {
        id,
        ...request,
        ...(grant && target && { grant: { label: grant.label, scope: target.scope } }),
      },
      ...(grant && target && { grant: { keys: grant.keys, target } }),
      decide,
    });
    signal.addEventListener('abort', abort, { once: true });
    notify();
  });
}
