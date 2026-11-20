import { emit, hostPorts } from '../../../core/ports';
import { notificationsContract, type NotificationTarget } from '../contract';

let armed = false;

export const NOTIFICATIONS_SNOOZE_KEY = 'notifications-snoozed-until';
// '0' 关闭（只停桌面弹窗，应用内通知列表不受影响），缺省视为开启；设置页读写同一个键。
const MAIL_NOTIFICATIONS_KEY = 'mail-notifications';

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

export function showMailNotice(
  id: string,
  title: string,
  body: string,
  target: NotificationTarget,
): void {
  if (!armed || snoozed() || setting(MAIL_NOTIFICATIONS_KEY) === '0') return;
  hostPorts().notifier.show(title, body, () => emit(notificationsContract, 'open', { id, target }));
}

/** Agent 任务提醒，点击只唤起主窗口。 */
export function systemNotifyToast(title: string, body: string): void {
  if (!armed || snoozed()) return;
  hostPorts().notifier.show(title, body);
}
