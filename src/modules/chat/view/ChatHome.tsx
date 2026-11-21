import { useQuery, useQueryClient } from '@tanstack/react-query';
import { agentClient } from './client';
import type { WorkspaceChat } from '../../../core/protocol/agent';
import { useSessions } from './sessions';
import { ChatTab } from './ChatTab';
import { errorMessage } from '../../../core/protocol/contract';

export interface HomeChatRequest {
  create: boolean;
  sessionId?: string;
  seq: number;
}

async function resolveHomeChat(request: HomeChatRequest | null): Promise<WorkspaceChat> {
  if (request?.sessionId) return agentClient['open-session']({ sessionId: request.sessionId });
  if (request?.create) return agentClient['create-session']({ projectId: null });
  const remembered = useSessions.getState().homeSessionId;
  if (remembered) {
    const reopened = await agentClient['open-session']({ sessionId: remembered }).catch(() => null);
    if (reopened) return reopened;
  }
  const empty = Object.values(useSessions.getState().chats).find(
    (chat) =>
      chat.sessionId &&
      !chat.running &&
      chat.messages.length === 0 &&
      (useSessions.getState().lists.general ?? []).some((row) => row.id === chat.sessionId),
  );
  return empty ?? agentClient['create-session']({ projectId: null });
}

export function ChatHome({ request }: { request: HomeChatRequest | null }) {
  const queryClient = useQueryClient();
  const queryKey = ['home-chat', request?.seq ?? 0];
  const { data: sessionId, error } = useQuery({
    queryKey,
    enabled: Boolean(window.delionBot),
    staleTime: Infinity,
    gcTime: 0,
    queryFn: async () => {
      const chat = await resolveHomeChat(request);
      if (!chat.sessionId) throw new Error('会话创建失败');
      if (queryClient.getQueryCache().find({ queryKey })?.getObserversCount()) {
        useSessions.getState().putChat(chat.sessionId, chat);
        useSessions.setState({ homeSessionId: chat.sessionId });
        void useSessions
          .getState()
          .refresh(chat.projectId)
          .catch(() => {});
      }
      return chat.sessionId;
    },
  });
  if (!sessionId)
    return (
      <div
        className="flex flex-1 items-center justify-center p-6 text-ui-body text-ink-2"
        role="status"
      >
        {error ? errorMessage(error) : '正在打开对话…'}
      </div>
    );
  return <ChatTab key={sessionId} tabId={`chat:${sessionId}`} groupId="home" />;
}
