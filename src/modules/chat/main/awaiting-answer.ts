import { row } from '../../../core/agent/session/store';
import { emit } from '../../../core/ports';
import { systemNotifyToast } from '../../notifications';
import { chatContract } from '../contract';

export function notifyAwaitingAnswer(sessionId: string) {
  const session = row(sessionId);
  systemNotifyToast('需要你的回答', session.title, () =>
    emit(chatContract, 'permissionRequestOpened', {
      sessionId,
      projectId: session.project_id,
    }),
  );
}
