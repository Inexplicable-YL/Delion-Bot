import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type {
  ChatComment,
  ChatMediaView,
  ChatQueuedDraft,
  SessionCommandName,
  WorkspaceChat,
} from '../../../core/protocol/agent';
import type { LlmProviderView } from '../../../core/protocol/llm';
import { llmModelSettings } from '../../../core/protocol/llm-models';
import { parseSessionCommand } from '../../../core/protocol/agent';
import {
  CHAT_ATTACHMENT_MAX,
  CHAT_DOCUMENT_MAX_BYTES,
  CHAT_TEXT_ATTACHMENT_MAX_BYTES,
  chatFileKindOfFile,
  hasChatImages,
  stripChatImageTokens,
} from '../../../core/protocol/chat-input';
import { agentClient } from './client';
import { showToast } from '../../../ui/Toast';
import { useChatTabSource } from './ChatSource';
import { useSessions } from './sessions';
import { isSessionViewed, useRuns } from './runs';
import {
  emptyDraft,
  registerChatAttachmentCheck,
  useChatDrafts,
  type ChatReference,
} from './drafts';
import type { ReferenceSource } from './ChatSource';
import { releaseChatMedia } from './media';
import { useChatAttachments } from './use-chat-attachments';
import { openSidechat } from './sidechat-store';
import { errorMessage } from '../../../core/protocol/contract';

export type { ChatReference };

export function canSendInput(
  text: string,
  direct: boolean,
  attachmentCount = 0,
  commentCount = 0,
): boolean {
  return direct
    ? text.trim().length > 0
    : Boolean(text.trim() || hasChatImages(text) || attachmentCount || commentCount);
}

export function shouldRestoreDraft(fresh: WorkspaceChat | null, sentText: string): boolean {
  if (!fresh) return true;
  const stripped = stripChatImageTokens(sentText);
  return !fresh.messages.some((message) => message.role === 'user' && message.content === stripped);
}

export function useChatDraft(sessionId: string) {
  return useChatDrafts((state) => state.drafts[sessionId] ?? emptyDraft);
}

export function useChat(
  sessionId: string,
  referenceSource?: ReferenceSource,
  onNewChat?: () => void,
) {
  const { navigate } = useChatTabSource();
  const chat = useSessions((state) => state.chats[sessionId] ?? null);
  const { attachments, update: setAttachments, hasAttachments, release } = useChatAttachments();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(0);
  const updateDraft = useChatDrafts((state) => state.update);
  const clearDraft = useChatDrafts((state) => state.clear);
  const flushReference = referenceSource?.flushReference;

  const [attachSession] = useState(() => (element: HTMLDivElement | null) => {
    if (!element) return;
    useRuns.getState().startViewing(sessionId);
    const stopCheckingAttachments = registerChatAttachmentCheck(hasAttachments);
    return () => {
      useRuns.getState().stopViewing(sessionId);
      stopCheckingAttachments();
      release();
    };
  });

  useQuery({
    queryKey: ['chat-session-seed', sessionId],
    enabled: !chat && Boolean(window.delionBot),
    queryFn: async () => {
      try {
        useSessions.getState().putChat(sessionId, await agentClient['open-session']({ sessionId }));
      } catch (e) {
        setError(errorMessage(e));
      }
      return null;
    },
  });

  const busy = pending > 0 || Boolean(chat?.running);
  const setPrompt = (update: (current: string) => string) => {
    const draft = useChatDrafts.getState().drafts[sessionId] ?? emptyDraft;
    updateDraft(sessionId, { prompt: update(draft.prompt) });
  };
  const setComments = (comments: ChatComment[]) => updateDraft(sessionId, { comments });

  const addAttachmentFile = async (file: File) => {
    if (!window.delionBot) throw new Error('附件仅在桌面端可用');
    if (attachments.length >= CHAT_ATTACHMENT_MAX)
      throw new Error(`附件最多 ${CHAT_ATTACHMENT_MAX} 个`);
    const limit =
      (await chatFileKindOfFile(file)) === 'text'
        ? CHAT_TEXT_ATTACHMENT_MAX_BYTES
        : CHAT_DOCUMENT_MAX_BYTES;
    if (file.size > limit) throw new Error(`附件超过 ${limit / 1024 / 1024} MB 上限`);
    const bytes = new Uint8Array(await file.arrayBuffer());
    const view = await agentClient['stage-media']({ name: file.name, bytes });
    setAttachments((current) => [...current, view]);
  };

  const addAttachmentView = (view: ChatMediaView) => {
    if (attachments.length >= CHAT_ATTACHMENT_MAX)
      throw new Error(`附件最多 ${CHAT_ATTACHMENT_MAX} 个`);
    setAttachments((current) =>
      current.some((item) => item.id === view.id) ? current : [...current, view],
    );
  };

  const removeAttachment = (id: string) => {
    setAttachments((current) => current.filter((item) => item.id !== id));
    releaseChatMedia([id]);
  };

  const send = async (references: ChatReference[]) => {
    const draft = useChatDrafts.getState().drafts[sessionId] ?? emptyDraft;
    const text = draft.prompt;
    const comments = draft.comments ?? [];
    if (!window.delionBot || !canSendInput(text, false, attachments.length, comments.length))
      return;
    const requested = sessionId;
    const hasImages = hasChatImages(text);
    const command = parseSessionCommand(hasImages ? stripChatImageTokens(text) : text);
    if (command) {
      if (busy) setError('运行中不能执行命令，请等待当前回答完成');
      else if (hasImages) setError('命令不能附带图片，请先移除图片');
      else if (comments.length) setError('命令不能附带评论，请先移除评论');
      else await runCommand(command.name, command.args, text);
      return;
    }
    const sentReferences = references.filter((ref) => !ref.session);
    const sentSessions = references.flatMap((ref) =>
      ref.session ? [{ id: ref.key, title: ref.title }] : [],
    );
    const sentAttachments = attachments;
    try {
      if (flushReference) {
        for (const ref of sentReferences) {
          if (ref.key.startsWith('source:')) continue;
          await flushReference(ref.key);
        }
      }
    } catch (e) {
      showToast({ variant: 'error', title: '发送失败', description: errorMessage(e) });
      return;
    }
    setPending((count) => count + 1);
    setError(null);
    clearDraft(requested);
    setAttachments([]);
    try {
      const result = await agentClient.ask({
        sessionId: requested,
        text,
        attachments: sentAttachments.map((item) => item.id),
        context: sentReferences.map((ref) => ref.key),
        ...(sentSessions.length ? { sessions: sentSessions } : {}),
        comments,
      });
      if (result.sessionId) useSessions.getState().putChat(result.sessionId, result);
    } catch (e) {
      setError(errorMessage(e));
      if (isSessionViewed(requested)) {
        const fresh = await agentClient['open-session']({ sessionId: requested }).catch(() => null);
        if (fresh) useSessions.getState().putChat(requested, fresh);
        if (isSessionViewed(requested) && shouldRestoreDraft(fresh, text)) {
          updateDraft(requested, { prompt: text, comments });
          setAttachments(sentAttachments);
        }
      }
    } finally {
      setPending((count) => Math.max(0, count - 1));
    }
  };

  const runCommand = async (name: SessionCommandName, args: string, text: string) => {
    if (!window.delionBot) return;
    const requested = sessionId;
    if (attachments.length) {
      setError('命令不能附带文件，请先移除附件');
      return;
    }
    setError(null);
    clearDraft(requested);
    if (name === 'new') {
      onNewChat?.();
      return;
    }
    if (name === 'btw') {
      void openSidechat(requested, { prompt: args });
      return;
    }
    setPending((count) => count + 1);
    try {
      const result = await agentClient['run-command']({ sessionId: requested, name, args });
      useSessions.getState().putChat(requested, result);
      if (name === 'name') {
        void useSessions
          .getState()
          .refresh(result.projectId)
          .catch(() => {});
        showToast({ variant: 'success', title: '已重命名' });
      } else if (name === 'reload') {
        showToast({
          variant: 'success',
          title: '已重新加载',
          description: 'Skills、扩展与 AGENTS.md 已按最新内容加载。',
        });
      }
    } catch (e) {
      setError(errorMessage(e));
      if (isSessionViewed(requested)) updateDraft(requested, { prompt: text });
    } finally {
      setPending((count) => Math.max(0, count - 1));
    }
  };

  const restoreQueued = (requested: string, queued: ChatQueuedDraft | null) => {
    if (!queued) return;
    const current = useChatDrafts.getState().drafts[requested] ?? emptyDraft;
    updateDraft(requested, {
      prompt: [queued.text, current.prompt].filter((text) => text.trim()).join('\n\n'),
      comments: [...queued.comments, ...(current.comments ?? [])],
    });
    if (isSessionViewed(requested)) setAttachments((list) => [...queued.attachments, ...list]);
    else releaseChatMedia(queued.attachments.map(({ id }) => id));
  };

  const stop = () => {
    const requested = sessionId;
    void agentClient['cancel-run']({ sessionId: requested })
      .then((queued) => restoreQueued(requested, queued))
      .catch(() => {});
  };

  const withdrawQueued = () => {
    const requested = sessionId;
    void agentClient['withdraw-queued']({ sessionId: requested })
      .then((queued) => restoreQueued(requested, queued))
      .catch((e) =>
        showToast({ variant: 'error', title: '撤回失败', description: errorMessage(e) }),
      );
  };

  const stopTask = (taskId: string) => {
    void agentClient['stop-task']({ sessionId, taskId }).catch((e) =>
      showToast({ variant: 'error', title: '停止失败', description: errorMessage(e) }),
    );
  };

  const editLast = async (text: string, comments: ChatComment[] = []) => {
    if (!window.delionBot || busy) return;
    const requested = sessionId;
    setPending((count) => count + 1);
    setError(null);
    try {
      const result = await agentClient.ask({
        sessionId: requested,
        text,
        attachments: [],
        context: [],
        comments,
        replaceLastUser: true,
      });
      if (result.sessionId) useSessions.getState().putChat(result.sessionId, result);
    } catch (e) {
      if (isSessionViewed(requested))
        showToast({ variant: 'error', title: '重新生成失败', description: errorMessage(e) });
    } finally {
      setPending((count) => Math.max(0, count - 1));
    }
  };

  const askAbout = async (text: string, context: string[]) => {
    if (!window.delionBot) return;
    const requested = sessionId;
    setPending((count) => count + 1);
    setError(null);
    try {
      const result = await agentClient.ask({
        sessionId: requested,
        text,
        attachments: [],
        context,
        comments: [],
      });
      if (result.sessionId) useSessions.getState().putChat(result.sessionId, result);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setPending((count) => Math.max(0, count - 1));
    }
  };

  const optimisticChat = (patch: Partial<WorkspaceChat>) => {
    const current = useSessions.getState().chats[sessionId];
    if (current) useSessions.getState().putChat(sessionId, { ...current, ...patch });
  };

  const selectModel = (provider: LlmProviderView, model: string) => {
    if (!window.delionBot) return;
    const { effort, effortLevels } = llmModelSettings(provider, model);
    optimisticChat({
      effort: effort ?? null,
      effortLevels,
      providerId: provider.id,
      providerName: provider.name,
      model,
      modelUnavailable: false,
    });
    void agentClient['set-model']({ sessionId, providerId: provider.id, model })
      .catch((e) =>
        showToast({ variant: 'error', title: '切换模型失败', description: errorMessage(e) }),
      )
      .finally(refresh);
  };

  const selectEffort = (level: string) => {
    if (!window.delionBot) return;
    optimisticChat({ effort: level });
    void agentClient['set-effort']({ sessionId, level })
      .then(() => refresh())
      .catch((e) =>
        showToast({ variant: 'error', title: '切换思考强度失败', description: errorMessage(e) }),
      );
  };

  const fork = (entryId: string) => {
    if (!window.delionBot) return;
    void agentClient
      .fork({ sessionId, entryId })
      .then((forked) => {
        useSessions.getState().putChat(forked.sessionId!, forked);
        navigate({ page: 'chat', projectId: forked.projectId, sessionId: forked.sessionId! });
      })
      .catch((e) =>
        showToast({ variant: 'error', title: '分支失败', description: errorMessage(e) }),
      );
  };

  const refresh = () => {
    if (!window.delionBot) return;
    void agentClient['open-session']({ sessionId })
      .then((value) => useSessions.getState().putChat(sessionId, value))
      .catch(() => {});
  };

  return [
    attachSession,
    {
      chat,
      busy,
      setPrompt,
      setComments,
      attachments,
      addAttachmentFile,
      addAttachmentView,
      removeAttachment,
      error,
      clearError: () => setError(null),
      send,
      stop,
      withdrawQueued,
      stopTask,
      editLast,
      askAbout,
      selectModel,
      selectEffort,
      fork,
      refresh,
    },
  ] as const;
}
