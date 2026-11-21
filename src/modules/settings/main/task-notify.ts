import { hostPorts } from '../../../core/ports';
import { systemNotifyToast } from '../../notifications';
import { getTaskNotificationPrefs } from './prefs';

export function notifyRunFinished(sessionId: string, status: 'completed' | 'failed'): void {
  try {
    const prefs = getTaskNotificationPrefs();
    if (status === 'completed' && !prefs.completed) return;
    if (status === 'failed' && !prefs.failed) return;
    const row = hostPorts()
      .database()
      .prepare('SELECT title FROM sessions WHERE id=?')
      .get(sessionId) as { title: string } | undefined;
    const title = status === 'completed' ? '任务完成' : '任务失败';
    systemNotifyToast(title, row?.title ?? 'Delion Bot 会话');
  } catch {}
}
