import { useQuery } from '@tanstack/react-query';
import type { Navigate } from '../../../app/module';
import { createClient, errorMessage } from '../../../core/protocol/contract';
import { showToast } from '../../../ui/Toast';
import { notificationsContract, type NotificationItem, type NotificationTarget } from '../contract';

export const notificationsClient = createClient(notificationsContract, window.delionBot?.bridge);

export function notifyFailure(reason: unknown): void {
  showToast({ variant: 'error', title: '通知操作失败', description: errorMessage(reason) });
}

export function useNotificationState() {
  return useQuery({
    queryKey: ['notifications', 'state'],
    queryFn: () => notificationsClient.state(),
    refetchInterval: 60_000,
  });
}

export function useNotificationCounts() {
  const { data } = useNotificationState();
  return {
    count: data?.snoozedUntil ? 0 : (data?.unreadCount ?? 0),
    todoUnread: data?.items.filter((item) => item.source === 'todo' && !item.readAt).length ?? 0,
  };
}

export function openTarget(target: NotificationTarget, navigate: Navigate): boolean {
  if (!('url' in target)) return navigate(target);
  window.open(target.url);
  return true;
}

export function openNotification(
  item: Pick<NotificationItem, 'id' | 'target' | 'readAt'>,
  navigate: Navigate,
): void {
  if (openTarget(item.target, navigate) && !item.readAt)
    void notificationsClient.markRead(item.id).catch(notifyFailure);
}
