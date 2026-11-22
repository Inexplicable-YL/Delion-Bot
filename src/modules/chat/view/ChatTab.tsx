import { cn } from '../../../ui/cn';
import { useState, type ReactNode } from 'react';
import { useMutation } from '@tanstack/react-query';
import {
  ArrowDownTrayIcon as Download,
  ClockIcon as History,
  PencilSquareIcon as SquarePen,
  QuestionMarkCircleIcon as MessageCircleQuestion,
} from '@heroicons/react/24/outline';
import type { TabId } from '../../../app/module';
import type { ChatComment, ChatSessionSummary, WorkspaceChat } from '../../../core/protocol/agent';
import { agentClient, chatClient } from './client';
import { Button } from '../../../ui/Button';
import { IconButton } from '../../../ui/IconButton';
import { ChatComposer } from './ChatComposer';
import { composerContext } from './composer-context';
import { ChatSessions } from './ChatSessions';
import { ChatThread } from './ChatThread';
import { ProjectSetup } from './ProjectSetup';
import {
  NoReferenceEntries,
  useChatTabSource,
  type ReferenceEntry,
  type ReferenceSource,
} from './ChatSource';
import { useChat, useChatDraft, type ChatReference } from './use-chat';
import { referenceContext, sessionReferences } from './reference-tokens';
import { exportSessionArchive, poolKey, updateSession, useSessions } from './sessions';
import { useWorkspaceStore } from '../../workspace/view';
import { showToast } from '../../../ui/Toast';
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

function ChatComposerArea({
  chat,
  chatState,
  error,
  files,
  sessionId,
  hero = false,
  home = false,
  hideAgentActions = false,
}: {
  chat: WorkspaceChat | null;
  chatState: ReturnType<typeof useChat>[1];
  error: string | null;
  files: ReferenceEntry[];
  sessionId: string;
  hero?: boolean;
  home?: boolean;
  hideAgentActions?: boolean;
}) {
  const { prompt, comments = noComments } = useChatDraft(sessionId);
  const referenceOptions = useReferenceOptions(files, chat);
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
    <div className="mx-auto w-full max-w-reading shrink-0">
      <ChatComposer
        hero={hero}
        hideAgentActions={hideAgentActions}
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
  const [attachSession, chatState] = useChat(active, referenceSource, startNewChat);
  const { chat, busy, editLast, fork, askAbout } = chatState;
  const project = useWorkspaceStore((state) =>
    state.workspace.entries.find((entry) => entry.id === projectId),
  );
  const [greeting] = useState(
    () => chatGreetings[Math.floor(Math.random() * chatGreetings.length)],
  );
  const [sessionsOpen, setSessionsOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const sidechatOpen = useSidechats((state) => Boolean(state.views[active]));
  const sidechatFromQuote = (quote: string) => void openSidechat(active, { quote });
  const subagent = chat?.subagent;
  const conversation = chat && (busy || chat.messages.length > 0 || chat.running || subagent);
  const showProjectSetup = chat && project?.kind === 'project' && !conversation;

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
        hideAgentActions={Boolean(showProjectSetup)}
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
      ref={attachSession}
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
          onAskImage={subagent ? undefined : askAbout}
          onEditLast={subagent ? undefined : editLast}
          onFork={subagent ? undefined : fork}
          onSidechat={subagent ? undefined : sidechatFromQuote}
          onOpenSource={onOpenSource}
          onOpenSession={openSession}
          onSaveNote={onSaveNote}
        />
      ) : (
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-app py-app">
          <div className="mx-auto my-auto grid w-full max-w-reading shrink-0 gap-6">
            <h1 className="wrap-anywhere text-center text-ui-large-title text-ink">
              {projectId === null ? greeting : project?.name}
            </h1>
            {composer(true)}
            {modelSetup}
            {showProjectSetup && (
              <ProjectSetup key={project.id} project={project} onOpenSession={openSession} />
            )}
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
        conversation && <div className="shrink-0 px-app pb-app">{composer(false)}</div>
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
