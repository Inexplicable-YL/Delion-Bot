import { defineModule } from '../../app/module';
import { implement } from '../../core/protocol/contract';
import { notificationsContract } from './contract';
import {
  markAllNotificationsRead,
  markNotificationRead,
  notificationState,
  refreshNotifications,
  setNotificationSnooze,
} from './main/store';

export {
  existingNotifications,
  publishNotificationState,
  registerNoticeSource,
  saveNotificationRefresh,
  systemNotifyItem,
  upsertNotification,
  type NoticeLink,
  type NoticeSource,
  type StoredNotice,
} from './main/store';
export { systemNotifyToast } from './main/system';

const REFRESH_MS = 2 * 60_000;

function refreshInBackground() {
  void refreshNotifications().catch((error: unknown) =>
    console.error('Notification refresh failed', error),
  );
}

export const notificationsModule = defineModule({
  id: 'notifications',
  ipc: implement(notificationsContract, {
    state: notificationState,
    refresh: () => refreshNotifications(true),
    markRead: markNotificationRead,
    markAllRead: markAllNotificationsRead,
    setSnooze: setNotificationSnooze,
  }),
  start() {
    refreshInBackground();
    const timer = setInterval(refreshInBackground, REFRESH_MS);
    return () => clearInterval(timer);
  },
});
