import { create } from 'zustand';
import type { ChatComment } from '../../../core/protocol/agent';
import { hasChatImages } from '../../../core/protocol/chat-input';

export type ChatReference = { key: string; title: string; session?: true };

type ChatDraft = { prompt: string; comments?: ChatComment[] };

export const emptyDraft: ChatDraft = { prompt: '' };

const STORAGE_KEY = 'delion.session.drafts';
const MAX_SESSIONS = 30;

export function registerChatAttachmentCheck(check: () => boolean): () => void {
  useChatDrafts.setState((state) => ({
    attachmentChecks: new Set(state.attachmentChecks).add(check),
  }));
  return () =>
    useChatDrafts.setState((state) => ({
      attachmentChecks: new Set([...state.attachmentChecks].filter((item) => item !== check)),
    }));
}

export function saveChatDrafts(): void {
  const { drafts, attachmentChecks } = useChatDrafts.getState();
  if (
    [...attachmentChecks].some((check) => check()) ||
    Object.values(drafts).some((draft) => hasChatImages(draft.prompt))
  ) {
    throw new Error('聊天中有尚未发送的附件或图片，请先发送或移除，再安装更新。');
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(drafts));
}

const isComment = (value: unknown): value is ChatComment =>
  Boolean(value) &&
  typeof value === 'object' &&
  typeof (value as ChatComment).quote === 'string' &&
  typeof (value as ChatComment).comment === 'string';

function loadStored(): Record<string, ChatDraft> {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}');
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const drafts: Record<string, ChatDraft> = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (
        !key.startsWith('sidechat:') &&
        value &&
        typeof value === 'object' &&
        'prompt' in value &&
        typeof value.prompt === 'string'
      ) {
        const comments =
          'comments' in value && Array.isArray(value.comments) && value.comments.every(isComment)
            ? value.comments
            : [];
        drafts[key] = comments.length
          ? { prompt: value.prompt, comments }
          : { prompt: value.prompt };
      }
    }
    return drafts;
  } catch {
    return {};
  }
}

function store(drafts: Record<string, ChatDraft>) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(drafts));
  } catch {}
}

function prune(drafts: Record<string, ChatDraft>): Record<string, ChatDraft> {
  const keys = Object.keys(drafts);
  if (keys.length <= MAX_SESSIONS) return drafts;
  const kept = { ...drafts };
  for (const key of keys.slice(0, keys.length - MAX_SESSIONS)) delete kept[key];
  return kept;
}

export const useChatDrafts = create<{
  drafts: Record<string, ChatDraft>;
  attachmentChecks: ReadonlySet<() => boolean>;
  update: (sessionId: string, patch: Partial<ChatDraft>) => void;
  clear: (sessionId: string) => void;
}>((set) => ({
  drafts: loadStored(),
  attachmentChecks: new Set(),
  update: (sessionId, patch) =>
    set((state) => {
      const drafts = prune({
        ...state.drafts,
        [sessionId]: { ...(state.drafts[sessionId] ?? emptyDraft), ...patch },
      });
      store(drafts);
      return { drafts };
    }),
  clear: (sessionId) =>
    set((state) => {
      if (!(sessionId in state.drafts)) return state;
      const drafts = { ...state.drafts };
      delete drafts[sessionId];
      store(drafts);
      return { drafts };
    }),
}));
