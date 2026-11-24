import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import '../../../core/host-mock';
import {
  decidePermissionRequest,
  permissionRequests,
  requestChatPermission,
} from '../../../../src/modules/chat/main/permission-requests';

describe('审批请求', () => {
  it('只接受所属会话对同一条请求的一次决定', async () => {
    const sessionId = randomUUID();
    const requested = requestChatPermission(
      sessionId,
      { kind: 'full', title: 'Approve', fields: [] },
      new AbortController().signal,
    );
    const [request] = permissionRequests(sessionId);
    expect(request?.kind).toBe('full');
    const id = request!.id;
    expect(decidePermissionRequest({ sessionId: randomUUID(), id, approved: true })).toBe(false);
    expect(decidePermissionRequest({ sessionId, id, approved: true })).toBe(true);
    expect(decidePermissionRequest({ sessionId, id, approved: true })).toBe(false);
    await expect(requested).resolves.toBe(true);
  });

  it('取消操作后立即撤回审批', async () => {
    const sessionId = randomUUID();
    const cancellation = new AbortController();
    const requested = requestChatPermission(
      sessionId,
      { kind: 'operation', title: 'Approve', fields: [] },
      cancellation.signal,
    );
    const [request] = permissionRequests(sessionId);
    cancellation.abort();
    expect(permissionRequests(sessionId)).toEqual([]);
    expect(decidePermissionRequest({ sessionId, id: request!.id, approved: true })).toBe(false);
    await expect(requested).resolves.toBe(false);
  });
});
