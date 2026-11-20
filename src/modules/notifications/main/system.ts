import { emit, hostPorts } from '../../../core/ports';
import { notificationsContract, type NotificationTarget } from '../contract';

let armed = false;

export const NOTIFICATIONS_SNOOZE_KEY = 'notifications-snoozed-until';

/** 启动首轮刷新完成后调用；此前收集到的存量通知作为基线，不弹系统通知。 */
export function armSystemNotifications(): void {
  armed = true;
}

function setting(key: string): string | undefined {
  return (
    hostPorts()
      .database()
      .prepare('SELECT value FROM workspace_settings WHERE key = ?')
      .get(key) as { value?: string } | undefined
  )?.value;
}

function snoozed(): boolean {
  const until = Date.parse(setting(NOTIFICATIONS_SNOOZE_KEY) ?? '');
  return !Number.isNaN(until) && until > Date.now();
}

export function showSystemNotice(
  id: string,
  title: string,
  body: string,
  target: NotificationTarget,
): void {
  if (!armed || snoozed()) return;
  hostPorts().notifier.show(title, body, () => emit(notificationsContract, 'open', { id, target }));
}

/** Agent 任务提醒，点击只唤起主窗口。 */
export function systemNotifyToast(title: string, body: string): void {
  if (!armed || snoozed()) return;
  hostPorts().notifier.show(title, body);
}
