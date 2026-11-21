import { cn } from '../../../ui/cn';
import { useState, type ReactNode } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import {
  ArrowDownTrayIcon as Download,
  ArrowsRightLeftIcon as GitCompare,
  ClockIcon as History,
  PencilSquareIcon as SquarePen,
  QuestionMarkCircleIcon as MessageCircleQuestion,
} from '@heroicons/react/24/outline';
import type { TabId } from '../../../app/module';
import type { ChatComment, ChatSessionSummary, WorkspaceChat } from '../../../core/protocol/agent';
import { agentClient, chatClient } from './client';
import { Button } from '../../../ui/button';
import { IconButton } from '../../../ui/icon-button';
import { ChatComposer } from './ChatComposer';
import { composerContext } from './composer-context';
import { ChatSessions } from './ChatSessions';
import { ChatThread } from './ChatThread';
import {
  NoReferenceEntries,
  useChatTabSource,
  type ReferenceEntry,
  type ReferenceSource,
} from './chat-source';
import { useChat, useChatDraft, type ChatReference } from './use-chat';
import { referenceContext, sessionReferences } from './reference-tokens';
import { exportSessionArchive, poolKey, updateSession, useSessions } from './sessions';
import { useWorkspaceStore } from '../../workspace/view';
import { showToast } from '../../../ui/toast';
import { reviewTabId } from './review/tab-id';
import { SidechatPanel } from './SidechatPanel';
import { openSidechat, useSidechats } from './sidechat-store';
import { errorMessage } from '../../../core/protocol/contract';

const chatGreetings = [
  '你准备好了，我就准备好了。',
  '今天想做点什么？',
  '有什么想一起解决的？',
  '我们从哪里开始？',
];

function parseChatTabId(tabId: string): string | null {
  if (!tabId.startsWith('chat:')) return null;
  const sessionId = tabId.slice('chat:'.length);
  return sessionId || null;
}

/** 会话身份来自 tabId（chat:{sessionId}），项目归属来自会话快照。 */
export function ChatTab({ tabId, groupId }: { tabId: TabId; groupId: string }) {
  const sessionId = parseChatTabId(tabId);
  const source = useChatTabSource();
  const projectId = useSessions((state) =>
    sessionId ? (state.chats[sessionId]?.projectId ?? null) : null,
  );
  const referenceSource = source.referenceSource;

  if (sessionId === null) {
    return (
      <div className="flex min-h-0 min-w-0 flex-1 items-center justify-center p-6 text-center text-ui-body text-ink-2">
        无效的会话标签
      </div>
    );
  }
  return (
    <ChatSessionView
      key={sessionId}
      active={sessionId}
      home={groupId === 'home'}
      onSaveNote={source.onSaveNote}
      projectId={projectId}
      referenceSource={referenceSource}
    />
  );
}

/** 输入草稿只在本层订阅：打字每键只重渲本层与 ChatComposer，不带动整棵消息树。 */
function ChatComposerArea({
  chat,
  chatState,
  error,
  files,
  sessionId,
  hero = false,
  home = false,
}: {
  /** 会话快照；IPC 返回前为 null，模型信息按空值降级。 */
  chat: WorkspaceChat | null;
  chatState: ReturnType<typeof useChat>;
  error: string | null;
  files: ReferenceEntry[];
  sessionId: string;
  hero?: boolean;
  home?: boolean;
}) {
  const { prompt, comments = noComments } = useChatDraft(sessionId);
  const referenceOptions = useReferenceOptions(files, chat);
  // 引用即文本：发送前从草稿文本解析 @token，附件与引用自此分开计数（附件维持上限 5）。
  const references = referenceContext(prompt, referenceOptions);
  const projectId = chat?.projectId ?? null;
  const project = useWorkspaceStore(
    (state) => state.workspace.entries.find((entry) => entry.id === projectId) ?? null,
  );
  const context = composerContext(chat, project, chatState.busy);
  const switchProject = useMutation({
    mutationFn: async ({
      nextProjectId,
    }: {
      previousProjectId: string | null;
      nextProjectId: string | null;
    }) => {
      await chatClient.move({ id: sessionId, projectId: nextProjectId });
      return agentClient['open-session']({ sessionId });
    },
    onSuccess: (moved, { previousProjectId }) => {
      const sessions = useSessions.getState();
      sessions.putChat(sessionId, moved);
      void Promise.all([
        sessions.refresh(previousProjectId),
        sessions.refresh(moved.projectId),
      ]).catch(() => {});
    },
    onError: (cause) =>
      showToast({ variant: 'error', title: '切换项目失败', description: errorMessage(cause) }),
  });
  return (
    <div className={cn('mx-auto w-full max-w-reading shrink-0', !hero && 'px-app pb-app')}>
      <ChatComposer
        hero={hero}
        attachments={chatState.attachments}
        comments={comments}
        onCommentsChange={chatState.setComments}
        busy={chatState.busy}
        configured={Boolean(chat?.configured)}
        context={context}
        effort={chat?.effort ?? null}
        effortLevels={chat?.effortLevels ?? []}
        model={chat?.model ?? ''}
        modelUnavailable={chat?.modelUnavailable ?? false}
        providerId={chat?.providerId ?? null}
        onAddAttachmentFile={chatState.addAttachmentFile}
        onAddAttachmentView={chatState.addAttachmentView}
        onChange={chatState.setPrompt}
        onEffortSelect={chatState.selectEffort}
        onModelSelect={chatState.selectModel}
        onRemoveAttachment={chatState.removeAttachment}
        contextUsage={chat?.contextUsage ?? null}
        onSelectProject={
          home && context
            ? (nextProjectId) =>
                switchProject.mutate({ previousProjectId: context.projectId, nextProjectId })
            : undefined
        }
        projectSwitching={switchProject.isPending}
        onSend={() => {
          if (!switchProject.isPending) void chatState.send(references);
        }}
        onStop={chatState.stop}
        queued={chat?.queued}
        onWithdrawQueued={chatState.withdrawQueued}
        tasks={chat?.tasks}
        onStopTask={chatState.stopTask}
        referenceOptions={referenceOptions}
        notice={error}
        onDismissNotice={chatState.clearError}
        value={prompt}
      />
    </div>
  );
}

const noReferences: ChatReference[] = [];
const noSessions: ChatSessionSummary[] = [];
const noComments: ChatComment[] = [];
/** @ 候选：会话快照就位前（projectId/cwd 未知）不列候选，避免列出别的项目的文件。 */
/** @ 文件候选来自容器注入；# 会话候选是同池的其他会话（各池列表启动时已载入镜像）。 */
function useReferenceOptions(files: ReferenceEntry[], chat: WorkspaceChat | null) {
  const projectId = chat?.projectId ?? null;
  const sessions = useSessions((state) => state.lists[poolKey(projectId)]);
  const sessionId = chat?.sessionId ?? null;
  const ready = chat !== null;
  return ready ? [...files, ...sessionReferences(sessions ?? noSessions, sessionId)] : noReferences;
}

function ChatSessionView({
  active,
  projectId,
  referenceSource,
  home,
  onSaveNote,
}: {
  active: string;
  projectId: string | null;
  referenceSource?: ReferenceSource;
  home: boolean;
  onSaveNote?: (text: string) => void;
}) {
  const { navigate, workbench } = useChatTabSource();
  const onOpenSource = (key: string) => workbench.openDocument(key);
  const startNewChat = () => navigate({ page: 'chat', projectId: home ? null : projectId });
  const openSession = (id: string) => navigate({ page: 'chat', projectId, sessionId: id });
  const chatState = useChat(active, referenceSource, startNewChat);
  const { chat, busy, editLast, fork } = chatState;
  const projectName = useWorkspaceStore(
    (state) => state.workspace.entries.find((entry) => entry.id === projectId)?.name,
  );
  const [greeting] = useState(
    () => chatGreetings[Math.floor(Math.random() * chatGreetings.length)],
  );
  const [sessionsOpen, setSessionsOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const sidechatOpen = useSidechats((state) => Boolean(state.views[active]));
  const sidechatFromQuote = (quote: string) => void openSidechat(active, { quote });
  // 工作区改动入口的可见性：轻探测会话目录是否为可审阅的 Git 仓库
  // （非仓库、缺 Git、远程项目都不显示，随聊无项目目录同样不显示）。
  const { data: reviewReady = false } = useQuery({
    queryKey: ['chat-uncommitted-availability', active, projectId],
    enabled: projectId !== null && Boolean(window.delionBot),
    staleTime: Infinity,
    gcTime: 0,
    queryFn: () =>
      chatClient
        .uncommittedAvailability(active)
        .then((value) => value.available)
        .catch(() => false),
  });

  // busy 涵盖「已发送但推送未到」的瞬间：点击发送立即进入会话态。
  // 不用 Boolean() 包裹，保留 TS 对 conversation 真值与 chat 非空的别名收窄。
  // 子 Agent 的会话只读：没有输入框，不能编辑重发、分支或旁问。
  const subagent = chat?.subagent;
  const conversation = chat && (busy || chat.messages.length > 0 || chat.running || subagent);

  const saveConversation = async () => {
    if (!window.delionBot) return;
    setExporting(true);
    try {
      await exportSessionArchive(active);
    } catch (error) {
      showToast({ variant: 'error', title: '会话导出失败', description: errorMessage(error) });
    }
    setExporting(false);
  };

  const ReferenceEntries = referenceSource?.Entries ?? NoReferenceEntries;
  const withReferences = (render: (files: ReferenceEntry[]) => ReactNode) => (
    <ReferenceEntries projectId={chat?.projectId ?? null} cwd={chat?.cwd ?? null}>
      {render}
    </ReferenceEntries>
  );
  const composer = (hero: boolean) =>
    withReferences((files) => (
      <ChatComposerArea
        chat={chat}
        chatState={chatState}
        error={chatState.error}
        files={files}
        sessionId={active}
        hero={hero}
        home={home}
      />
    ));

  const modelSetup = chat && !chat.configured && (
    <div className="flex flex-wrap items-center gap-2 pb-3 text-ui-callout text-ink-2">
      <span>配置模型后即可发送消息。</span>
      <Button
        size="sm"
        variant="accent"
        onClick={() => navigate({ page: 'settings', section: 'providers' })}
      >
        配置模型
      </Button>
    </div>
  );

  return (
    <div
      aria-label="对话"
      className={cn(
        'relative flex min-h-0 min-w-0 flex-1 flex-col @container',
        home && !conversation ? 'bg-page' : 'bg-surface',
      )}
    >
      <div className="flex min-h-toolbar shrink-0 items-center gap-1 px-app">
        <IconButton aria-label="历史对话" onClick={() => setSessionsOpen(true)} title="历史对话">
          <History />
        </IconButton>
        <IconButton aria-label="新对话" onClick={startNewChat} title="新对话">
          <SquarePen />
        </IconButton>
        {reviewReady && (
          <IconButton
            aria-label="工作区改动"
            onClick={() =>
              workbench.open(reviewTabId({ kind: 'uncommitted', sessionId: active }), {
                aside: true,
              })
            }
            title="查看工作区未提交的改动"
          >
            <GitCompare />
          </IconButton>
        )}
        <div className="flex-1" />
        {chat && chat.messages.length > 0 && (
          <IconButton
            aria-label="导出会话"
            disabled={busy || chat.running || chat.compacting || exporting}
            onClick={() => void saveConversation()}
            title="导出会话 ZIP"
          >
            <Download />
          </IconButton>
        )}
        {conversation && !sidechatOpen && !subagent && (
          <IconButton
            aria-label="旁问"
            onClick={() => void openSidechat(active)}
            title="旁问：带着当前对话顺便问一句（/btw）"
          >
            <MessageCircleQuestion />
          </IconButton>
        )}
      </div>
      {conversation && modelSetup}
      {conversation ? (
        <ChatThread
          chat={chat}
          onEditLast={subagent ? undefined : editLast}
          onFork={subagent ? undefined : fork}
          onSidechat={subagent ? undefined : sidechatFromQuote}
          onOpenSource={onOpenSource}
          onOpenSession={openSession}
          onSaveNote={onSaveNote}
        />
      ) : (
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-app py-app">
          <div className="mx-auto my-auto grid w-full max-w-reading gap-6">
            <h1 className="wrap-anywhere text-center text-ui-large-title text-ink">
              {projectId === null ? greeting : projectName}
            </h1>
            {composer(true)}
            {modelSetup}
          </div>
        </div>
      )}
      {subagent ? (
        <div className="mx-auto flex w-full max-w-reading shrink-0 items-center gap-2 px-6 py-3 text-ui-subhead text-ink-2">
          <span className="min-w-0 truncate">子 Agent · {subagent.description} · 只读</span>
          <Button size="sm" variant="ghost" onClick={() => openSession(subagent.parentId)}>
            回到父会话
          </Button>
        </div>
      ) : (
        conversation && composer(false)
      )}
      {sidechatOpen &&
        withReferences((files) => (
          <SidechatPanel
            onOpenSource={onOpenSource}
            parentId={active}
            files={files}
            flushReference={referenceSource?.flushReference}
          />
        ))}
      <ChatSessions
        currentSessionId={active}
        onDeleteSession={(id) => {
          void updateSession(id, { archived: true })
            .then(() => {
              workbench.close(`chat:${id}`);
              if (home && useSessions.getState().homeSessionId === id)
                navigate({ page: 'chat', projectId: null });
            })
            .catch((error) => {
              showToast({ variant: 'error', title: '归档失败', description: errorMessage(error) });
            });
        }}
        onOpenChange={setSessionsOpen}
        onOpenSession={openSession}
        open={sessionsOpen}
        projectId={projectId}
      />
    </div>
  );
}
