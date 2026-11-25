// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  window.delionBot = {
    bridge: { invoke: async () => undefined, subscribe: () => () => {} },
  } as unknown as NonNullable<typeof window.delionBot>;
});
import { PermissionNotices } from '../../../../src/modules/chat/view/PermissionNotices';
import { useSessions } from '../../../../src/modules/chat/view/sessions';
import { useRuns } from '../../../../src/modules/chat/view/runs';

const projectId = '00000000-0000-4000-8000-000000000001';
const waitingId = '00000000-0000-4000-8000-000000000002';
const activeId = '00000000-0000-4000-8000-000000000003';
const answerId = '00000000-0000-4000-8000-000000000006';
const request = (id: string) => ({
  id,
  kind: 'operation' as const,
  title: '运行受限命令',
  fields: [],
});

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  useSessions.setState({
    lists: {
      [projectId]: [
        { id: waitingId, title: '整理发布说明', updatedAt: '', createdAt: '', pinned: false },
      ],
    },
    permissions: {
      [waitingId]: [request('00000000-0000-4000-8000-000000000004')],
      [activeId]: [request('00000000-0000-4000-8000-000000000005')],
    },
  } as never);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

it('提醒未聚焦会话的审批，并跳转回该会话', () => {
  const onOpen = vi.fn();
  act(() => root.render(<PermissionNotices activeSessionId={activeId} onOpen={onOpen} />));
  const notices = container.querySelectorAll('[role="group"]');
  expect(notices).toHaveLength(1);
  expect(notices[0]!.textContent).toContain('整理发布说明');
  act(() => container.querySelector<HTMLButtonElement>('button:not([aria-label])')!.click());
  expect(onOpen).toHaveBeenCalledWith(waitingId, projectId);
});

it('提醒其他会话里等待回答的询问，同一会话有审批时只提醒审批', () => {
  useRuns.setState({
    bySession: {
      [answerId]: { runId: 'run-answer', status: 'waiting_input' },
      [waitingId]: { runId: 'run-waiting', status: 'waiting_input' },
      [activeId]: { runId: 'run-active', status: 'waiting_input' },
    },
  });
  act(() => root.render(<PermissionNotices activeSessionId={activeId} onOpen={vi.fn()} />));
  const notices = [...container.querySelectorAll('[role="group"]')].map(
    (notice) => notice.textContent,
  );
  expect(notices).toHaveLength(2);
  expect(notices.filter((text) => text?.includes('需要你的回答'))).toHaveLength(1);
});
