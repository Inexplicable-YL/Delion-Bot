import { defineView, type NoticeKind } from '../../../app/module';
import { subscribe } from '../../../core/protocol/contract';
import { notificationsContract } from '../contract';
import { notificationsPage } from './NotificationsView';
import { openNotification } from './use-notifications';

export {
  notificationsClient,
  useNotificationCounts,
  useNotificationState,
} from './use-notifications';

export function notificationsView(kinds: Record<string, NoticeKind>) {
  return defineView({
    pages: { notifications: { component: notificationsPage(kinds) } },
    start(navigate) {
      subscribe(notificationsContract, window.delionBot?.bridge, 'open', ({ id, target }) =>
        openNotification({ id, target, readAt: null }, navigate),
      );
    },
  });
}
