import { create } from 'zustand';
import type {
  AgentToolOutput,
  ChatSessionSummary,
  WorkspaceChat,
} from '../../../core/protocol/agent';
import { showToast } from '../../../ui/Toast';
import {
  agentClient,
  chatClient,
  onAgentEvent,
  onCompactionChanged,
  onCompactionStream,
} from './client';

export function poolKey(projectId: string | null): string {
  return projectId ?? 'general';
}

interface SessionsState {
  lists: Record<string, ChatSessionSummary[]>;
  chats: Record<string, WorkspaceChat>;
  compacted: Record<string, { entryId: string; messages: ChatMessage[] }>;
  homeSessionId: string | null;
  refreshTimers: Record<string, ReturnType<typeof setTimeout>>;
  refresh: (projectId: string | null) => Promise<void>;
  putChat: (sessionId: string, chat: WorkspaceChat) => void;
  forgetSession: (sessionId: string) => void;
}

const listRefreshDelayMs = 300;

export const useSessions = create<SessionsState>((set, get) => {
  const scheduleListRefresh = (projectId: string | null) => {
    const key = poolKey(projectId);
    clearTimeout(get().refreshTimers[key]);
    const timer = setTimeout(() => {
      set((state) => ({
        refreshTimers: Object.fromEntries(
          Object.entries(state.refreshTimers).filter(([pool]) => pool !== key),
        ),
      }));
      void get()
        .refresh(projectId)
        .catch(() => {});
    }, listRefreshDelayMs);
    set((state) => ({ refreshTimers: { ...state.refreshTimers, [key]: timer } }));
  };

  return {
    lists: {},
    chats: {},
    compacted: {},
    homeSessionId: null,
    refreshTimers: {},
    refresh: async (projectId) => {
      if (typeof window === 'undefined' || !window.delionBot) return;
      const sessions = await chatClient.listSessions({ projectId });
      set((state) => ({ lists: { ...state.lists, [poolKey(projectId)]: sessions } }));
    },
    putChat: (sessionId, chat) => {
      const previous = get().chats[sessionId];
      set((state) => ({ chats: { ...state.chats, [sessionId]: chat } }));
      if ((previous?.messages.length ?? 0) !== chat.messages.length)
        scheduleListRefresh(chat.projectId);
    },
    forgetSession: (sessionId) =>
      set((state) => {
        const chats = { ...state.chats };
        delete chats[sessionId];
        const compacted = { ...state.compacted };
        delete compacted[sessionId];
        const lists: Record<string, ChatSessionSummary[]> = {};
        for (const [key, list] of Object.entries(state.lists))
          lists[key] = list.filter((item) => item.id !== sessionId);
        return { chats, compacted, lists };
      }),
  };
});

export function querySessions(
  projectId: string | null,
  query: string,
): Promise<ChatSessionSummary[]> {
  return typeof window !== 'undefined' && window.delionBot
    ? chatClient.listSessions({ projectId, query })
    : Promise.resolve([]);
}

onAgentEvent('session-update', ({ sessionId, chat }) => {
  useSessions.getState().putChat(sessionId, chat);
});
onCompactionChanged(({ sessionId, ...transcript }) => {
  useSessions.setState((state) => ({
    compacted: { ...state.compacted, [sessionId]: transcript },
  }));
});
onCompactionStream(({ sessionId, entryId, message }) => {
  useSessions.setState((state) => {
    const transcript = state.compacted[sessionId];
    if (transcript?.entryId !== entryId) return state;
    const messages = mergeStreamReply(transcript.messages, message);
    return { compacted: { ...state.compacted, [sessionId]: { entryId, messages } } };
  });
});
onAgentEvent('session-stream', ({ sessionId, message, activeTool, contextUsage }) => {
  const current = useSessions.getState().chats[sessionId];
  if (!current?.running) return;
  const messages = mergeStreamReply(current.messages, message);
  useSessions.getState().putChat(sessionId, { ...current, messages, activeTool, contextUsage });
});
onAgentEvent('queue', ({ sessionId, queued }) => {
  const current = useSessions.getState().chats[sessionId];
  if (current) useSessions.getState().putChat(sessionId, { ...current, queued });
});

type ChatMessage = WorkspaceChat['messages'][number];
type ToolStep = NonNullable<ChatMessage['toolResults']>[number];

function mergeStreamReply(messages: ChatMessage[], message: ChatMessage): ChatMessage[] {
  const last = messages.at(-1);
  return last?.role === 'assistant' &&
    last.startedAt === message.startedAt &&
    last.finishedAt === undefined
    ? [...messages.slice(0, -1), keepToolImages(last, message)]
    : [...messages, message];
}

export function keepToolImages(previous: ChatMessage | undefined, next: ChatMessage): ChatMessage {
  const images = new Map<string, NonNullable<AgentToolOutput['image']>>();
  for (const step of previous?.toolResults ?? [])
    if (step.output?.image) images.set(step.id, step.output.image);
  if (!images.size) return next;
  const fill = (step: ToolStep): ToolStep => {
    const image = images.get(step.id);
    return image && step.output && !step.output.image
      ? { ...step, output: { ...step.output, image } }
      : step;
  };
  return {
    ...next,
    ...(next.toolResults && { toolResults: next.toolResults.map(fill) }),
    ...(next.parts && {
      parts: next.parts.map((part) =>
        part.type === 'tools' ? { ...part, results: part.results.map(fill) } : part,
      ),
    }),
  };
}

export async function updateSession(
  sessionId: string,
  patch: { archived?: boolean; pinned?: boolean },
): Promise<void> {
  if (!window.delionBot) throw new Error('会话管理仅在桌面端可用');
  await chatClient.update({ id: sessionId, patch });
  await refreshSessionLists();
}

export async function moveSession(sessionId: string, projectId: string | null): Promise<void> {
  if (!window.delionBot) throw new Error('会话管理仅在桌面端可用');
  await chatClient.move({ id: sessionId, projectId });
  if (projectId !== null && useSessions.getState().homeSessionId === sessionId)
    useSessions.setState({ homeSessionId: null });
  await refreshSessionLists();
}

export async function exportSessionArchive(sessionId: string): Promise<void> {
  const { saved, missing } = await chatClient.export(sessionId);
  if (saved)
    showToast({
      variant: missing.length ? 'neutral' : 'success',
      title: missing.length ? '会话已导出，部分文件未打包' : '会话已导出',
      description: missing.length ? missing.join('、') : undefined,
    });
}

export async function renameSession(sessionId: string, title: string): Promise<void> {
  await agentClient['run-command']({ sessionId, name: 'name', args: title });
  await refreshSessionLists();
}

export async function refreshSessionLists(): Promise<void> {
  await Promise.all(
    Object.keys(useSessions.getState().lists).map((key) =>
      useSessions.getState().refresh(key === 'general' ? null : key),
    ),
  );
}
