import { useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  ArrowDownIcon as ArrowDown,
  ChatBubbleLeftIcon as MessageSquare,
  CommandLineIcon as SquareTerminal,
  CpuChipIcon as Bot,
  DocumentTextIcon as FileText,
  PencilIcon as Pencil,
  PencilSquareIcon as NotebookPen,
  ShareIcon as GitBranch,
} from '@heroicons/react/24/outline';
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
import { Shimmer } from '../../../ui/Shimmer';
import type { ChatComment, TaskNoticeDetails, WorkspaceChat } from '../../../core/protocol/agent';
import { chatImageToken } from '../../../core/protocol/chat-input';
import { openLightbox } from '../../../ui/Lightbox';
import { IconButton } from '../../../ui/IconButton';
import { useMediaQuery } from '../../../ui/use-media-query';
import { useChatTabSource } from './ChatSource';
import { formatDuration, ReplyTrace } from './ToolTimeline';
import { openSubagent } from './ToolViews';
import { ChatMarkdown } from './Markdown';
import { ReplyCommentLayer } from './ReplyComment';
import { fetchChatMediaPreview, getChatMediaPreview } from './media';
import { TurnChangesCard } from './TurnChangesCard';
import { ReplySources } from './ReplySources';
import { ReplyImageContext } from './ReplyImageContext';

const textAnimation = { animation: 'fadeIn', sep: 'char' } as const;

function MessageImage({ id, name }: { id: string; name: string }) {
  const { data: url } = useQuery({
    queryKey: ['chat', 'media', id],
    queryFn: () => fetchChatMediaPreview(id),
    initialData: getChatMediaPreview(id),
    staleTime: Infinity,
  });
  return url ? (
    <button
      aria-label={`放大查看 ${name || '图片'}`}
      className="cursor-zoom-in"
      onClick={() => openLightbox(url, name)}
      title={name || undefined}
      type="button"
    >
      <img
        alt={name}
        className="size-20 rounded-card border border-line border-line/60 object-cover"
        src={url}
      />
    </button>
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
  message: WorkspaceChat['messages'][number];
  onOpenSource: ((key: string) => void) | undefined;
  onOpenSession: ((id: string) => void) | undefined;
  onEdit: (text: string) => void;
  editable: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(message.content);
  const confirmEdit = () => {
    const tokens = (message.images ?? [])
      .map((image) => chatImageToken(image.id, image.name))
      .join('\n');
    const next = [text.trim(), tokens].filter(Boolean).join('\n');
    setEditing(false);
    onEdit(next);
  };
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
      {message.sources?.length ? (
        <MessageChips>
          {message.sources.map((source) => (
            <MessageChip
              key={source.key}
              onClick={onOpenSource && (() => onOpenSource(source.key))}
            >
              {source.title}
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

const INTERRUPT_PREFIX = '本次执行中断：';
function splitInterrupt(parts: NonNullable<WorkspaceChat['messages'][number]['parts']>) {
  const last = parts.at(-1);
  if (last?.type === 'text' && last.text.startsWith(INTERRUPT_PREFIX))
    return { parts: parts.slice(0, -1), reason: last.text.slice(INTERRUPT_PREFIX.length) };
  return { parts, reason: null };
}

function AssistantMessage({
  message,
  live,
  turnEnd,
  animate,
  activeTool,
  sessionId,
  reviewEnabled,
  onSaveNote,
  onFork,
  onRetry,
}: {
  message: WorkspaceChat['messages'][number];
  live: boolean;
  turnEnd: boolean;
  animate: boolean;
  activeTool: string | undefined;
  sessionId: string | null;
  reviewEnabled: boolean;
  onSaveNote: ((text: string) => void) | undefined;
  onFork: ((entryId: string) => void) | undefined;
  onRetry: (() => void) | undefined;
}) {
  const reduced = useMediaQuery('(prefers-reduced-motion: reduce)');
  const split = splitInterrupt(message.parts ?? []);
  const parts = split.parts;
  const reason = message.interrupted ? (split.reason ?? '未知错误') : null;
  const empty = !parts.some((part) =>
    part.type === 'tools' ? part.results.length > 0 : Boolean(part.text.trim()),
  );
  const content = reason
    ? parts.flatMap((part) => (part.type === 'text' ? [part.text] : [])).join('\n\n')
    : message.content;

  return (
    <AssistantMessageFrame data-reply-live={live || undefined}>
      {live && empty && (
        <p className="h-7 text-ui-body" role="status">
          <Shimmer>Thinking</Shimmer>
        </p>
      )}
      <ReplyTrace
        key={message.startedAt}
        live={live}
        parts={parts}
        startedAt={message.startedAt}
        finishedAt={message.finishedAt}
        renderText={(text) => (
          <ChatMarkdown
            mode={live ? 'streaming' : 'static'}
            isAnimating={live && !activeTool}
            animated={live && animate && !reduced ? textAnimation : false}
            replyImages
          >
            {text}
          </ChatMarkdown>
        )}
      />
      {reason && <ErrorCard onRetry={onRetry} reason={reason} />}
      {message.stopped && !live && <p className="my-2 text-ui-body text-ink-2">已停止</p>}
      {!live && turnEnd && sessionId && message.turnId && (
        <TurnChangesCard
          sessionId={sessionId}
          turnId={message.turnId}
          reviewEnabled={reviewEnabled}
        />
      )}
      {!live && (content || Boolean(message.toolResults?.length)) && (
        <MessageActions className="mt-1 has-[[data-slot=popover-trigger]]:opacity-100">
          {message.toolResults?.length ? <ReplySources steps={message.toolResults} /> : null}
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
          {content && onFork && message.entryId && (
            <IconButton
              aria-label="从这里分支"
              onClick={() => onFork(message.entryId!)}
              title="从这里分支为新对话"
            >
              <GitBranch />
            </IconButton>
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
  draftKey,
}: {
  chat: WorkspaceChat;
  onAskImage?: (text: string, context: string[]) => Promise<void>;
  onSidechat?: (quote: string) => void;
  draftKey?: string | null;
  onOpenSource?: (key: string) => void;
  onOpenSession?: (id: string) => void;
  onSaveNote?: (text: string) => void;
  onEditLast?: (text: string, comments?: ChatComment[]) => void;
  onFork?: (entryId: string) => void;
}) {
  const replyDraftKey = draftKey === undefined ? chat.sessionId : draftKey;
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

  const messages = chat.messages;
  const streaming = Boolean(chat.running);
  const [resumedReplyAt] = useState(() => {
    const last = chat.messages.at(-1);
    return chat.running && last?.role === 'assistant' && last.content.trim()
      ? last.startedAt
      : undefined;
  });

  const lastUserIndex = messages.findLastIndex((message) => message.role === 'user');

  const turnEnds = new Map<string, number>();
  messages.forEach((message, index) => {
    if (message.role === 'assistant' && message.turnId) turnEnds.set(message.turnId, index);
  });

  const replyStartedAt = messages[lastUserIndex + 1]?.startedAt;
  const observeScroll = (content: HTMLDivElement | null) => {
    if (!content) return;
    const viewport = content.parentElement as HTMLDivElement;
    const key = `${chat.sessionId}:${lastUserIndex}:${replyStartedAt ?? ''}`;
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
    onEditLast && lastUser
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
                <CompactionDivider key={`${chat.sessionId}:${index}`} />
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
                  editable={index === lastUserIndex && !streaming && onEditLast !== undefined}
                />
              ) : (
                <AssistantMessage
                  key={`${chat.sessionId}:${index}`}
                  sessionId={chat.sessionId}
                  reviewEnabled={chat.projectId != null}
                  onRetry={index === messages.length - 1 && !streaming ? retry : undefined}
                  live={streaming && index === messages.length - 1}
                  turnEnd={message.turnId !== undefined && turnEnds.get(message.turnId) === index}
                  animate={message.startedAt !== resumedReplyAt}
                  message={message}
                  activeTool={chat.activeTool}
                  onSaveNote={onSaveNote}
                  onFork={streaming ? undefined : onFork}
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
