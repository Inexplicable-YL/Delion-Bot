import { create } from 'zustand';
import type { ChatAskInput, SidechatView } from '../../../core/protocol/agent';
import { agentClient, onAgentEvent } from './client';
import { keepToolImages } from './sessions';
import { showToast } from '../../../ui/Toast';
import { emptyDraft, useChatDrafts } from './drafts';
import { errorMessage } from '../../../core/protocol/contract';

interface SidechatState {
  views: Record<string, SidechatView>;
  collapsed: Record<string, boolean>;
  entered: Record<string, boolean>;
  put: (view: SidechatView) => void;
  forget: (parentId: string) => void;
  setCollapsed: (parentId: string, collapsed: boolean) => void;
  markEntered: (parentId: string) => void;
}

export const useSidechats = create<SidechatState>((set) => ({
  views: {},
  collapsed: {},
  entered: {},
  put: (view) => set((state) => ({ views: { ...state.views, [view.parentId]: view } })),
  forget: (parentId) =>
    set((state) => {
      const views = { ...state.views };
      const collapsed = { ...state.collapsed };
      const entered = { ...state.entered };
      delete views[parentId];
      delete collapsed[parentId];
      delete entered[parentId];
      return { views, collapsed, entered };
    }),
  setCollapsed: (parentId, value) =>
    set((state) => ({ collapsed: { ...state.collapsed, [parentId]: value } })),
  markEntered: (parentId) => set((state) => ({ entered: { ...state.entered, [parentId]: true } })),
}));

export const sidechatDraftKey = (parentId: string) => `sidechat:${parentId}`;

export async function openSidechat(
  parentId: string,
  options: { quote?: string; question?: ChatAskInput } = {},
) {
  if (!window.delionBot) return;
  const key = sidechatDraftKey(parentId);
  const drafts = useChatDrafts.getState();
  const draft = drafts.drafts[key] ?? emptyDraft;
  if (options.quote)
    drafts.update(key, {
      comments: [...(draft.comments ?? []), { quote: options.quote, comment: '' }],
    });
  useSidechats.getState().setCollapsed(parentId, false);
  try {
    useSidechats.getState().put(await agentClient['open-sidechat']({ parentId }));
  } catch (error) {
    if (options.question) throw error;
    showToast({ variant: 'error', title: '打开旁问失败', description: errorMessage(error) });
    return;
  }
  if (options.question) {
    const view = await agentClient['ask-sidechat']({ parentId, ...options.question });
    if (useSidechats.getState().views[parentId]) useSidechats.getState().put(view);
  }
}

onAgentEvent('sidechat-update', (view) => {
  if (useSidechats.getState().views[view.parentId]) useSidechats.getState().put(view);
});
onAgentEvent('sidechat-stream', ({ sessionId, message, activeTool }) => {
  const current = useSidechats.getState().views[sessionId];
  if (!current?.running) return;
  const last = current.messages.at(-1);
  const replaceLast =
    last?.role === 'assistant' &&
    last.startedAt === message.startedAt &&
    last.finishedAt === undefined;
  const messages = replaceLast
    ? [...current.messages.slice(0, -1), keepToolImages(last, message)]
    : [...current.messages, message];
  useSidechats.getState().put({ ...current, messages, activeTool });
});
onAgentEvent('sidechat-closed', ({ parentId }) => useSidechats.getState().forget(parentId));
