import { randomUUID } from 'node:crypto';
import { emit } from '../../../core/ports';
import { chatContract, type PermissionRequest } from '../contract';

const pending = new Map<
  string,
  { sessionId: string; request: PermissionRequest; decide: (approved: boolean) => void }
>();

export function permissionRequests(sessionId: string): PermissionRequest[] {
  return [...pending.values()]
    .filter((entry) => entry.sessionId === sessionId)
    .map(({ request }) => request);
}

export function decidePermissionRequest(input: {
  sessionId: string;
  id: string;
  approved: boolean;
}) {
  const entry = pending.get(input.id);
  if (!entry || entry.sessionId !== input.sessionId) return false;
  entry.decide(input.approved);
  return true;
}

export function requestChatPermission(
  sessionId: string,
  input: Omit<PermissionRequest, 'id'>,
  signal: AbortSignal,
): Promise<boolean> {
  if (signal.aborted) return Promise.resolve(false);
  const id = randomUUID();
  return new Promise((resolve) => {
    const notify = () =>
      emit(chatContract, 'permissionRequestsChanged', {
        sessionId,
        requests: permissionRequests(sessionId),
      });
    const abort = () => decide(false);
    const decide = (approved: boolean) => {
      pending.delete(id);
      signal.removeEventListener('abort', abort);
      resolve(approved && !signal.aborted);
      notify();
    };
    pending.set(id, { sessionId, request: { id, ...input }, decide });
    signal.addEventListener('abort', abort, { once: true });
    notify();
  });
}
