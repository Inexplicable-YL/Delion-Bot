import { useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  ArrowDownIcon as ArrowDown,
  ArrowPathIcon as ArrowPath,
  ChatBubbleLeftIcon as MessageSquare,
  CommandLineIcon as SquareTerminal,
  CpuChipIcon as Bot,
  DocumentTextIcon as FileText,
  EllipsisHorizontalIcon as Ellipsis,
  PencilIcon as Pencil,
  PencilSquareIcon as NotebookPen,
} from '@heroicons/react/24/outline';
import { BranchIcon } from '../../../ui/BranchIcon';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '../../../ui/DropdownMenu';
import {
  AssistantMessage as AssistantMessageFrame,
  CompactionDivider,
  CopyAction,
  ErrorCard,
  ExtensionMessage,
  MessageActions,
  MessageChip,
  MessageChips,
  MessageComments,
  UserBubble,
  UserMessage as UserMessageFrame,
  UserMessageEditor,
} from '../../../ui/agent/Message';
import { TaskNotice } from '../../../ui/agent/Task';
import type { ChatComment, TaskNoticeDetails, WorkspaceChat } from '../../../core/protocol/agent';
import type { CompactionHistoryMessage, LocalCommandReply } from '../contract';
import { chatImageToken } from '../../../core/protocol/chat-input';
import { IconButton } from '../../../ui/IconButton';
import { useMediaQuery } from '../../../ui/use-media-query';
import { useNow } from '../../../ui/use-now';
import { useChatTabSource } from './ChatSource';
import { formatDuration, ReplyTrace } from './ToolTimeline';
import { openSubagent } from './ToolViews';
import { ChatMarkdown } from './Markdown';
import { ReplyCommentLayer } from './ReplyComment';
import { fetchChatMediaPreview, getChatMediaPreview } from './media';
import { TurnChangesCard } from './TurnChangesCard';
import { ReplySources } from './ReplySources';
import { ReplyImageContext, useReplyImageContext } from './ReplyImageContext';
import { ImageQuestionForm, ImageViewer } from './ReplyImageViewer';
import { chatMediaUrl } from './reply-images';
import { chatClient } from './client';
import { fileLinkKey, matchReferenceTokens, sourceReferences } from './reference-tokens';
import { useWorkspaceStore } from '../../workspace/view';

const textAnimation = { animation: 'fadeIn', sep: 'char' } as const;

function MessageImage({ id, name }: { id: string; name: string }) {
  const { data: url } = useQuery({
    queryKey: ['chat', 'media', id],
    queryFn: () => fetchChatMediaPreview(id),
    initialData: getChatMediaPreview(id),
    staleTime: Infinity,
  });
  const ask = useReplyImageContext()?.ask;
  const [viewing, setViewing] = useState(false);
  const title = name || '图片';
  return url ? (
    <>
      <button
        aria-label={`放大查看 ${title}`}
        className="cursor-zoom-in"
        onClick={() => setViewing(true)}
        title={name || undefined}
        type="button"
      >
        <img
          alt={name}
          className="size-20 rounded-card border border-line border-line/60 object-cover"
          src={url}
        />
      </button>
      {viewing && (
        <ImageViewer
          footer={
            ask && (
              <ImageQuestionForm
                label={`关于“${title}”的询问`}
                onAsk={async (question) => {
                  setViewing(false);
                  void ask(
                    `${question}
${chatImageToken(id, name)}`,
                    [],
                  );
                }}
              />
            )
          }
          images={[{ src: chatMediaUrl(id), title, mediaId: id }]}
          index={0}
          onClose={() => setViewing(false)}
          onDownload={() => chatClient.saveChatImage({ id, name: title })}
        />
      )}
    </>
  ) : (
    <span
      className="grid size-20 place-items-center rounded-card border border-line border-line/60 bg-inset text-ui-subhead text-ink-2"
      title={name || undefined}
    >
      图片
    </span>
  );
}

function UserMessage({
  message,
  onOpenSource,
  onOpenSession,
  onEdit,
  editable,
}: {
  message: ThreadMessage;
  onOpenSource: ((key: string) => void) | undefined;
  onOpenSession: ((id: string) => void) | undefined;
  onEdit: (text: string) => void;
  editable: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(message.content);
  if (message.localCommand) {
    return (
      <UserMessageFrame>
        <UserBubble>
          <p className="whitespace-pre-wrap">{message.content}</p>
        </UserBubble>
      </UserMessageFrame>
    );
  }
  const confirmEdit = () => {
    const tokens = (message.images ?? [])
      .map((image) => chatImageToken(image.id, image.name))
      .join('\n');
    const next = [text.trim(), tokens].filter(Boolean).join('\n');
    setEditing(false);
    onEdit(next);
  };
  const sourceOptions = sourceReferences(message.sources ?? []);
  const inlineSources = new Set(
    matchReferenceTokens(message.content, sourceOptions).map((token) => token.ref.key),
  );
  const looseSources = (message.sources ?? []).filter((source) => !inlineSources.has(source.key));
  const images = message.images?.length ? (
    <MessageChips>
      {message.images.map((image) => (
        <MessageImage id={image.id} key={image.id} name={image.name} />
      ))}
    </MessageChips>
  ) : null;
  if (editing) {
    return (
      <UserMessageEditor
        onCancel={() => setEditing(false)}
        onChange={setText}
        onSubmit={confirmEdit}
        submitDisabled={!text.trim() && !message.images?.length}
        value={text}
      >
        {images}
      </UserMessageEditor>
    );
  }
  return (
    <UserMessageFrame>
      {message.comments?.length ? <MessageComments comments={message.comments} /> : null}
      {message.content ? (
        <UserBubble>
          <ChatMarkdown
            className="[&_code]:bg-transparent [&_code]:px-0 [&_pre]:bg-transparent [&_[data-streamdown=code-block]]:bg-transparent [&_[data-streamdown=code-block-header]]:bg-transparent"
            mode="static"
            references={
              onOpenSource && inlineSources.size
                ? { options: sourceOptions, onOpen: onOpenSource }
                : undefined
            }
          >
            {message.content}
          </ChatMarkdown>
        </UserBubble>
      ) : null}
      {images}
      {message.attachments?.length ? (
        <MessageChips>
          {message.attachments.map((attachment, index) => (
            <MessageChip
              icon={<FileText className="size-4 shrink-0 text-ink-2" />}
              key={`${attachment.name}:${index}`}
              title={attachment.name}
            >
              {attachment.name}
            </MessageChip>
          ))}
        </MessageChips>
      ) : null}
      {looseSources.length ? (
        <MessageChips>
          {looseSources.map((source) => (
            <MessageChip
              icon={<FileText className="size-4 shrink-0 text-ink-2" />}
              key={source.key}
              onClick={onOpenSource && (() => onOpenSource(source.key))}
              title={source.title}
            >
              {source.title.split(/[\\/]/).at(-1)}
            </MessageChip>
          ))}
        </MessageChips>
      ) : null}
      {message.sessions?.length ? (
        <MessageChips>
          {message.sessions.map((session) => (
            <MessageChip
              icon={<MessageSquare className="size-4 shrink-0 text-ink-2" />}
              key={session.id}
              onClick={onOpenSession && (() => onOpenSession(session.id))}
              title={session.title}
            >
              {session.title}
            </MessageChip>
          ))}
        </MessageChips>
      ) : null}
      <MessageActions>
        {message.content ? <CopyAction label="复制消息" text={message.content} /> : null}
        {editable && (
          <IconButton
            aria-label="编辑消息"
            onClick={() => {
              setText(message.content);
              setEditing(true);
            }}
            title="编辑并重新发送"
          >
            <Pencil />
          </IconButton>
        )}
      </MessageActions>
    </UserMessageFrame>
  );
}

const clockFormat = new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit' });
const dateFormat = new Intl.DateTimeFormat('zh-CN', { month: 'long', day: 'numeric' });
const fullDateFormat = new Intl.DateTimeFormat('zh-CN', {
  year: 'numeric',
  month: 'long',
  day: 'numeric',
});

function ReplyTime({ at }: { at: number }) {
  const now = new Date(useNow(60_000));
  const date = new Date(at);
  const clock = clockFormat.format(date);
  const today = new Date(now).setHours(0, 0, 0, 0);
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1).getTime();
  const day = date.getFullYear() === now.getFullYear() ? dateFormat : fullDateFormat;
  const label =
    at >= today
      ? `今天 ${clock}`
      : at >= yesterday
        ? `昨天 ${clock}`
        : `${day.format(date)} ${clock}`;
  return <DropdownMenuLabel className="tabular-nums">{label}</DropdownMenuLabel>;
}

const INTERRUPT_PREFIX = '本次执行中断：';
type ReplyParts = NonNullable<WorkspaceChat['messages'][number]['parts']>;
type ReplyTraceData = { parts: ReplyParts; durationMs: number };

function replyDuration({ startedAt, finishedAt }: WorkspaceChat['messages'][number]): number {
  return startedAt !== undefined && finishedAt !== undefined
    ? Math.max(0, finishedAt - startedAt)
    : 0;
}

function splitInterrupt(parts: ReplyParts) {
  const last = parts.at(-1);
  if (last?.type === 'text' && last.text.startsWith(INTERRUPT_PREFIX))
    return { parts: parts.slice(0, -1), reason: last.text.slice(INTERRUPT_PREFIX.length) };
  return { parts, reason: null };
}

type ThreadMessage = CompactionHistoryMessage & { localCommand?: true };

function foldContinuedReplies(
  messages: ThreadMessage[],
  turnEnds: ReadonlyMap<string, number>,
  streaming: boolean,
) {
  const folded = new Map<number, ReplyTraceData | null>();
  const pending: (ReplyTraceData & { index: number })[] = [];
  messages.forEach((message, index) => {
    if (message.task?.turnId || message.compacted || message.localCommand) pending.length = 0;
    if (
      message.role !== 'assistant' ||
      message.extension ||
      message.task ||
      message.compacted ||
      message.localCommand ||
      (streaming && index === messages.length - 1)
    )
      return;

    const { parts } = splitInterrupt(message.parts ?? []);
    const last = parts.findLast((part) =>
      part.type === 'tools' ? part.results.length > 0 : Boolean(part.text.trim()),
    );
    const continued = message.turnId !== undefined && turnEnds.get(message.turnId) !== index;
    const complete = !continued && !message.stopped && !message.interrupted;
    if (last?.type === 'text' && complete) {
      if (pending.length) {
        for (const trace of pending) folded.set(trace.index, null);
        folded.set(index, {
          parts: [...pending.flatMap((trace) => trace.parts), ...parts],
          durationMs: pending.reduce(
            (total, trace) => total + trace.durationMs,
            replyDuration(message),
          ),
        });
      }
      pending.length = 0;
    } else if (last && parts.some((part) => part.type !== 'text'))
      pending.push({ index, parts, durationMs: replyDuration(message) });
    else if (!last && complete && message.content.trim()) pending.length = 0;
  });
  return folded;
}

function AssistantMessage({
  message,
  foldedTrace,
  live,
  turnEnd,
  animate,
  activeTool,
  sessionId,
  showTurnChanges,
  onSaveNote,
  onFork,
  onRetry,
  onOpenFile,
  fileMenu,
  asks,
}: {
  message: ThreadMessage;
  foldedTrace: ReplyTraceData | null | undefined;
  live: boolean;
  turnEnd: boolean;
  animate: boolean;
  activeTool: string | undefined;
  sessionId: string | null;
  showTurnChanges: boolean;
  onSaveNote: ((text: string) => void) | undefined;
  onFork: ((entryId: string) => void) | undefined;
  onRetry: (() => void) | undefined;
  onOpenFile: ((path: string) => void) | undefined;
  fileMenu: { sessionId: string; remote: boolean } | undefined;
  asks: { answer?: string; onAnswer?: (text: string) => Promise<void> } | undefined;
}) {
  const reduced = useMediaQuery('(prefers-reduced-motion: reduce)');
  if (message.localCommand) {
    return (
      <AssistantMessageFrame>
        <p className="whitespace-pre-wrap text-ink">{message.content}</p>
      </AssistantMessageFrame>
    );
  }
  const split = splitInterrupt(message.parts ?? []);
  const parts = foldedTrace?.parts ?? split.parts;
  const reason = message.interrupted ? (split.reason ?? '未知错误') : null;
  const moved = foldedTrace === null;
  const content = moved
    ? ''
    : reason
      ? split.parts.flatMap((part) => (part.type === 'text' ? [part.text] : [])).join('\n\n')
      : message.content;
  const toolResults = moved
    ? undefined
    : foldedTrace
      ? parts.flatMap((part) => (part.type === 'tools' ? part.results : []))
      : message.toolResults;
  const showChanges = showTurnChanges && !live && turnEnd && sessionId && message.turnId;
  const forkEntryId = content && onFork ? message.entryId : undefined;
  const repliedAt = message.finishedAt ?? message.startedAt;
  if (moved && !reason && !message.stopped && !showChanges) return null;

  return (
    <AssistantMessageFrame data-reply-live={live || undefined}>
      {!moved && (
        <ReplyTrace
          key={foldedTrace ? 'continued' : message.startedAt}
          live={live}
          parts={parts}
          startedAt={message.startedAt}
          durationMs={foldedTrace?.durationMs ?? replyDuration(message)}
          renderText={(text) => (
            <ChatMarkdown
              mode={live ? 'streaming' : 'static'}
              isAnimating={live && !activeTool}
              animated={live && animate && !reduced ? textAnimation : false}
              references={onOpenFile && { onOpen: onOpenFile, fileMenu }}
              asks={asks}
              replyImages
            >
              {text}
            </ChatMarkdown>
          )}
        />
      )}
      {reason && <ErrorCard onRetry={onRetry} reason={reason} />}
      {message.stopped && !live && <p className="my-2 text-ui-body text-ink-2">已停止</p>}
      {showChanges && <TurnChangesCard sessionId={sessionId} turnId={showChanges} />}
      {!live && (content || Boolean(toolResults?.length)) && (
        <MessageActions className="mt-1 opacity-100">
          {toolResults?.length ? <ReplySources steps={toolResults} /> : null}
          {content && <CopyAction label="复制回答" text={content} />}
          {content && onSaveNote && (
            <IconButton
              aria-label="保存为笔记"
              onClick={() => onSaveNote(content)}
              title="保存为笔记"
            >
              <NotebookPen />
            </IconButton>
          )}
          {(onRetry || forkEntryId) && (
            <DropdownMenu modal={false}>
              <DropdownMenuTrigger asChild>
                <IconButton aria-label="更多操作" title="更多操作">
                  <Ellipsis />
                </IconButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                {repliedAt !== undefined && <ReplyTime at={repliedAt} />}
                {onRetry && (
                  <DropdownMenuItem onSelect={onRetry}>
                    <ArrowPath />
                    重试
                  </DropdownMenuItem>
                )}
                {forkEntryId && (
                  <DropdownMenuItem onSelect={() => onFork!(forkEntryId)}>
                    <BranchIcon />
                    创建对话分支
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </MessageActions>
      )}
    </AssistantMessageFrame>
  );
}

const TASK_STATUS: Record<TaskNoticeDetails['status'], string> = {
  completed: '已完成',
  failed: '失败',
  stopped: '已停止',
};

function TaskNoticeMessage({ content, task }: { content: string; task: TaskNoticeDetails }) {
  const { navigate } = useChatTabSource();
  return (
    <TaskNotice
      duration={formatDuration(task.durationMs)}
      failed={task.status === 'failed'}
      icon={task.kind === 'bash' ? SquareTerminal : Bot}
      label={task.label}
      onOpenSession={
        task.kind === 'subagent' ? () => void openSubagent(task.taskId, navigate) : undefined
      }
      title={`后台任务${TASK_STATUS[task.status]}${
        task.exitCode !== undefined && task.status === 'failed' ? `（退出码 ${task.exitCode}）` : ''
      }`}
    >
      <ChatMarkdown className="pt-1.5 text-ui-body" mode="static">
        {content}
      </ChatMarkdown>
    </TaskNotice>
  );
}

export function ChatThread({
  chat,
  onOpenSource,
  onOpenSession,
  onSaveNote,
  onEditLast,
  onFork,
  onSidechat,
  onAskImage,
  onAnswer,
  draftKey,
  fileSessionId = chat.sessionId,
  compactionHistory,
  messagesAfterCompaction,
  commandReplies,
}: {
  chat: WorkspaceChat;
  commandReplies?: LocalCommandReply[];
  compactionHistory?: CompactionHistoryMessage[];
  messagesAfterCompaction?: WorkspaceChat['messages'];
  onAskImage?: (text: string, context: string[]) => Promise<void>;
  onAnswer?: (text: string) => Promise<void>;
  onSidechat?: (quote: string) => void;
  draftKey?: string | null;
  fileSessionId?: string | null;
  onOpenSource?: (key: string) => void;
  onOpenSession?: (id: string) => void;
  onSaveNote?: (text: string) => void;
  onEditLast?: (text: string, comments?: ChatComment[]) => void;
  onFork?: (entryId: string) => void;
}) {
  const replyDraftKey = draftKey === undefined ? chat.sessionId : draftKey;
  const { openReplyFile } = useChatTabSource();
  const remoteProject = useWorkspaceStore((state) =>
    state.workspace.entries.some((entry) => entry.id === chat.projectId && entry.remoteId),
  );
  const openFile =
    onOpenSource &&
    ((path: string) => {
      const key = fileLinkKey(
        path,
        chat.cwd,
        remoteProject ? chat.projectId : null,
        chat.permissionMode === 'restricted',
      );
      if (openReplyFile && fileSessionId) openReplyFile(key, fileSessionId, chat.projectId);
      else onOpenSource(key);
    });
  const scrollRef = useRef<HTMLDivElement>(null);
  const [atBottom, setAtBottom] = useState(true);
  const [scroll] = useState(() => {
    let followBottom = false;
    let lineHeight = 0;
    let lastTop = 0;
    let anchor: string | null = null;
    const update = (element: HTMLDivElement) => {
      if (!lineHeight) {
        const style = getComputedStyle(element);
        lineHeight = parseFloat(style.lineHeight) || parseFloat(style.fontSize);
      }
      const atBottomNow =
        element.scrollHeight - element.scrollTop - element.clientHeight <= lineHeight;
      setAtBottom(atBottomNow);
      if (atBottomNow) followBottom = true;
      else if (element.scrollTop < lastTop) followBottom = false;
      lastTop = element.scrollTop;
    };
    return {
      update,
      setFollowing: (next: boolean) => {
        followBottom = next;
      },
      anchorTo: (key: string, element: HTMLDivElement, streaming: boolean) => {
        if (anchor === key) return;
        anchor = key;
        followBottom = streaming;
        element.scrollTo({ top: element.scrollHeight, behavior: 'instant' });
      },
      resize: (element: HTMLDivElement) => {
        lineHeight = 0;
        if (followBottom) element.scrollTop = element.scrollHeight;
        update(element);
      },
    };
  });

  const first = chat.messages[0];
  const transcript: ThreadMessage[] = compactionHistory
    ? [...compactionHistory, ...(messagesAfterCompaction ?? [])]
    : first?.compacted
      ? chat.messages.slice(1)
      : chat.messages;
  const local = (commandReplies ?? [])
    .flatMap(
      ({ input, reply, sentAt, repliedAt }) =>
        [
          { role: 'user', content: input, startedAt: sentAt, localCommand: true },
          {
            role: 'assistant',
            content: reply,
            startedAt: repliedAt,
            localCommand: true,
          },
        ] satisfies ThreadMessage[],
    )
    .sort((a, b) => a.startedAt - b.startedAt);
  const messages: ThreadMessage[] = [];
  let cursor = 0;
  for (const message of transcript) {
    while (cursor < local.length && local[cursor]!.startedAt < (message.startedAt ?? 0)) {
      messages.push(local[cursor++]!);
    }
    messages.push(message);
  }
  messages.push(...local.slice(cursor));
  const historyLength = messages.findLastIndex((message) => message.compacted) + 1;
  const streaming = Boolean(chat.running);
  const lastMessage = messages.at(-1);
  if (streaming && !chat.compacting && lastMessage?.role === 'user' && !lastMessage.localCommand)
    messages.push({ role: 'assistant', content: '', parts: [], startedAt: lastMessage.startedAt });
  const [resumedReplyAt] = useState(() => {
    const last = chat.messages.at(-1);
    return chat.running && last?.role === 'assistant' && last.content.trim()
      ? last.startedAt
      : undefined;
  });

  const lastVisibleUserIndex = messages.findLastIndex((message) => message.role === 'user');
  const lastUserIndex = messages.findLastIndex(
    (message) => message.role === 'user' && !message.localCommand,
  );

  const turnEnds = new Map<string, number>();
  messages.forEach((message, index) => {
    if (message.role === 'assistant' && message.turnId) turnEnds.set(message.turnId, index);
  });
  const foldedTraces = foldContinuedReplies(messages, turnEnds, streaming);

  const replyStartedAt = messages[lastVisibleUserIndex + 1]?.startedAt;
  const observeScroll = (content: HTMLDivElement | null) => {
    if (!content) return;
    const viewport = content.parentElement as HTMLDivElement;
    const key = `${chat.sessionId}:${lastVisibleUserIndex}:${replyStartedAt ?? ''}`;
    scroll.anchorTo(key, viewport, streaming);
    const resize = () => scroll.resize(viewport);
    resize();
    let frame = 0;
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(resize);
    });
    observer.observe(content);
    observer.observe(viewport);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  };

  const handleEditLast = (text: string) => onEditLast?.(text);
  const lastUser = lastUserIndex >= 0 ? messages[lastUserIndex] : undefined;
  const retry =
    onEditLast && lastUser && lastUserIndex >= historyLength
      ? () => {
          const tokens = (lastUser.images ?? []).map((image) =>
            chatImageToken(image.id, image.name),
          );
          onEditLast([lastUser.content, ...tokens].filter(Boolean).join('\n'), lastUser.comments);
        }
      : undefined;

  return (
    <div className="relative min-h-0 flex-1">
      <div
        ref={scrollRef}
        className="size-full overflow-y-auto [overflow-anchor:none]"
        aria-label="对话消息"
        onScroll={(event) => scroll.update(event.currentTarget)}
        onClickCapture={(event) => {
          if ((event.target as HTMLElement).closest('[data-trace-toggle]'))
            scroll.setFollowing(false);
        }}
      >
        <ReplyImageContext.Provider
          value={
            chat.sessionId ? { sessionId: chat.sessionId, cwd: chat.cwd, ask: onAskImage } : null
          }
        >
          <div
            ref={observeScroll}
            className="relative mx-auto w-full max-w-reading px-app py-app-gap"
          >
            {messages.map((message, index) =>
              message.compacted ? (
                <CompactionDivider
                  key={message.entryId ?? `${chat.sessionId}:${index}`}
                  mode={message.compaction?.mode}
                  releasedTokens={message.compaction?.releasedTokens}
                >
                  {message.entryId && message.content && (
                    <ChatMarkdown className="text-ui-body" mode="static">
                      {message.content}
                    </ChatMarkdown>
                  )}
                </CompactionDivider>
              ) : message.task ? (
                <TaskNoticeMessage
                  content={message.content}
                  key={`${chat.sessionId}:${index}`}
                  task={message.task}
                />
              ) : message.extension ? (
                <ExtensionMessage
                  customType={message.extension.customType}
                  key={`${chat.sessionId}:${index}`}
                >
                  <ChatMarkdown className="text-ui-body" mode="static">
                    {message.content}
                  </ChatMarkdown>
                </ExtensionMessage>
              ) : message.role === 'user' ? (
                <UserMessage
                  key={`${chat.sessionId}:${index}`}
                  message={message}
                  onOpenSource={onOpenSource}
                  onOpenSession={onOpenSession}
                  onEdit={handleEditLast}
                  editable={
                    index >= historyLength &&
                    index === lastUserIndex &&
                    !streaming &&
                    onEditLast !== undefined
                  }
                />
              ) : (
                <AssistantMessage
                  key={`${chat.sessionId}:${index}`}
                  sessionId={chat.sessionId}
                  showTurnChanges={chat.projectId !== null}
                  onRetry={
                    index === messages.length - 1 && !streaming && !message.localCommand
                      ? retry
                      : undefined
                  }
                  live={streaming && index === messages.length - 1 && !message.localCommand}
                  turnEnd={message.turnId !== undefined && turnEnds.get(message.turnId) === index}
                  animate={message.startedAt !== resumedReplyAt}
                  message={message}
                  foldedTrace={foldedTraces.get(index)}
                  activeTool={chat.activeTool}
                  onSaveNote={onSaveNote}
                  onFork={streaming || index < historyLength ? undefined : onFork}
                  onOpenFile={openFile}
                  fileMenu={
                    fileSessionId ? { sessionId: fileSessionId, remote: remoteProject } : undefined
                  }
                  asks={
                    onAnswer &&
                    (index > lastUserIndex
                      ? { onAnswer: streaming ? undefined : onAnswer }
                      : {
                          answer: messages.find(
                            (next, nextIndex) =>
                              nextIndex > index && next.role === 'user' && !next.localCommand,
                          )?.content,
                        })
                  }
                />
              ),
            )}
            {chat.compacting && <CompactionDivider pending />}
          </div>
        </ReplyImageContext.Provider>
      </div>
      {!atBottom && messages.length > 0 && (
        <button
          aria-label="回到底部"
          className="absolute bottom-3 left-1/2 z-10 grid size-8 -translate-x-1/2 place-items-center rounded-full border border-line bg-surface text-ink-2 shadow-raised transition-colors hover:bg-hover-strong hover:text-ink"
          onClick={() => {
            scroll.setFollowing(true);
            const el = scrollRef.current;
            const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
            el?.scrollTo({ top: el.scrollHeight, behavior: reduced ? 'auto' : 'smooth' });
          }}
          type="button"
        >
          <ArrowDown className="size-4" />
        </button>
      )}
      {replyDraftKey && (
        <ReplyCommentLayer draftKey={replyDraftKey} onSidechat={onSidechat} scrollRef={scrollRef} />
      )}
    </div>
  );
}
