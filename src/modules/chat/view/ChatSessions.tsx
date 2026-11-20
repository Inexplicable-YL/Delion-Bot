import { useState } from 'react';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { useDebounce } from 'use-debounce';
import {
  ArchiveBoxIcon as Archive,
  ChatBubbleLeftIcon as MessageSquare,
  XMarkIcon as X,
} from '@heroicons/react/24/outline';
import type { ChatSessionSummary } from '../../../core/protocol/agent';
import { Button } from '../../../ui/button';
import { useDismissOnOutsidePointer } from '../../../ui/use-dismiss-on-outside-pointer';
import { EmptyState } from '../../../ui/empty-state';
import { IconButton } from '../../../ui/icon-button';
import { SearchInput } from '../../../ui/search-input';
import { cn } from '../../../ui/cn';
import { poolKey, querySessions } from './sessions';
import { Sheet, SheetContent } from '../../../ui/sheet';
import { errorMessage } from '../../../core/protocol/contract';

function SessionList({
  sessions,
  currentSessionId,
  onOpenSession,
  onDeleteSession,
  onClose,
}: {
  sessions: ChatSessionSummary[];
  currentSessionId: string | null;
  onOpenSession: (sessionId: string) => void;
  onDeleteSession: (sessionId: string) => void;
  onClose: () => void;
}) {
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  useDismissOnOutsidePointer(confirmingId !== null, '[data-archive-confirm]', () =>
    setConfirmingId(null),
  );
  return (
    <>
      {sessions.map((session) => (
        <div
          className="group flex items-center gap-2 rounded-chip px-2 py-1.5 transition-colors hover:bg-hover"
          key={session.id}
        >
          <button
            className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
            onClick={() => {
              onOpenSession(session.id);
              onClose();
            }}
            type="button"
          >
            <MessageSquare
              className={cn(
                'size-4 shrink-0',
                session.id === currentSessionId ? 'text-ink' : 'text-ink-2',
              )}
            />
            <span
              className={cn(
                'min-w-0 flex-1 truncate text-ui-body text-ink',
                session.id === currentSessionId && 'font-medium',
              )}
            >
              {session.title || '新对话'}
            </span>
          </button>
          {confirmingId === session.id ? (
            <Button
              data-archive-confirm=""
              onClick={() => {
                setConfirmingId(null);
                onDeleteSession(session.id);
              }}
              size="sm"
              variant="destructive"
            >
              确认归档
            </Button>
          ) : (
            <IconButton
              aria-label={`归档对话 ${session.title}`}
              className="opacity-0 transition-opacity focus-visible:opacity-100 group-hover:opacity-100 max-md:opacity-100"
              onClick={() => setConfirmingId(session.id)}
              title="归档对话"
            >
              <Archive />
            </IconButton>
          )}
        </div>
      ))}
    </>
  );
}

export function ChatSessions({
  projectId,
  currentSessionId,
  open,
  onOpenChange,
  onOpenSession,
  onDeleteSession,
}: {
  projectId: string | null;
  currentSessionId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onOpenSession: (sessionId: string) => void;
  onDeleteSession: (sessionId: string) => void;
}) {
  const queryClient = useQueryClient();
  const [query, setQuery] = useState('');
  const [searchTerm] = useDebounce(query.trim(), 200);
  const pools = projectId === null ? [null] : [projectId, null];
  const sessionLists = useQuery({
    queryKey: ['chat', 'session-search', projectId, searchTerm],
    queryFn: () =>
      Promise.all(pools.map((pool) => querySessions(pool, searchTerm))).catch((cause) => {
        console.error(errorMessage(cause));
        throw cause;
      }),
    enabled: open,
    // 新结果到达前保留旧列表，面板打开与查询期间不闪空态文案。
    placeholderData: keepPreviousData,
  });
  // 查询失败不静默呈现为空态：给一行错误与重试；新查询成功即复位。
  const loadError = sessionLists.isError;
  const lists = loadError ? undefined : sessionLists.data;

  const deleteSession = (sessionId: string) => {
    onDeleteSession(sessionId);
    // 面板保持打开时列表仍可见：先乐观移除，再重取列表覆盖在途旧请求，
    // 也让删除失败（IPC 报错）时该行按服务端事实恢复。
    queryClient.setQueriesData<ChatSessionSummary[][]>(
      { queryKey: ['chat', 'session-search'] },
      (current) => current?.map((list) => list.filter((item) => item.id !== sessionId)),
    );
    void queryClient.invalidateQueries({ queryKey: ['chat', 'session-search'] });
    void queryClient.invalidateQueries({ queryKey: ['chat', 'archived'] });
  };

  const sections = pools.map((pool, index) => ({
    pool,
    key: poolKey(pool),
    label: pool === null && projectId !== null ? '通用对话' : null,
    list: lists?.[index] ?? null,
  }));
  const allLoaded = sections.every((section) => section.list !== null);
  const totalCount = sections.reduce((count, section) => count + (section.list?.length ?? 0), 0);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" title="历史对话">
        <h2 className="px-2 pt-2 text-ui-title-2" aria-hidden>
          历史对话
        </h2>
        <div className="flex shrink-0 items-center gap-1 p-2">
          <SearchInput
            aria-label="搜索历史对话"
            autoFocus
            className="flex-1"
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索对话内容…"
            value={query}
          />
          <IconButton aria-label="关闭" onClick={() => onOpenChange(false)}>
            <X />
          </IconButton>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto border-t border-line p-2">
          {loadError && (
            <div className="flex items-center justify-center gap-2 px-3 py-6 text-ui-body text-ink-2">
              <span role="alert">历史对话加载失败</span>
              <Button onClick={() => void sessionLists.refetch()} size="sm" variant="outline">
                重试
              </Button>
            </div>
          )}
          {allLoaded && totalCount === 0 && (
            <EmptyState title={query ? '没有匹配的对话' : '还没有历史对话'} />
          )}
          {sections.map((section) =>
            section.list && section.list.length > 0 ? (
              <section key={section.key} aria-label={section.label ?? '项目会话'}>
                {section.label && (
                  <h3 className="px-2 pb-1 pt-2 text-ui-subhead text-ink-2">{section.label}</h3>
                )}
                <SessionList
                  currentSessionId={currentSessionId}
                  onClose={() => onOpenChange(false)}
                  onDeleteSession={deleteSession}
                  onOpenSession={onOpenSession}
                  sessions={section.list}
                />
              </section>
            ) : null,
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
