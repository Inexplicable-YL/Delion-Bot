import { useWorkbenchLayout } from '../workbench/layout-store';
import { useNavigationStore } from './view';

export const sessionDragType = 'application/x-delion-session';
export const archivedSessionDragType = 'application/x-delion-archived-session';

export function openDroppedSession(dataTransfer: DataTransfer, groupId: string, index?: number) {
  const sessionId = dataTransfer.getData(sessionDragType);
  if (!sessionId) return;
  const open = () => useWorkbenchLayout.getState().openTab(`chat:${sessionId}`, groupId, { index });
  if (dataTransfer.types.includes(archivedSessionDragType)) {
    useNavigationStore
      .getState()
      .requestChatRestore(
        sessionId,
        useWorkbenchLayout.getState().projectId,
        dataTransfer.getData(archivedSessionDragType),
        open,
      );
  } else open();
}
