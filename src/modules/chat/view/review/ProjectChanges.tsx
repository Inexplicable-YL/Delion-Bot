import { useState } from 'react';
import { queryOptions, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowPathIcon, DocumentIcon } from '@heroicons/react/24/outline';
import type { TabId } from '../../../../app/module';
import { errorMessage } from '../../../../core/protocol/contract';
import { cn } from '../../../../ui/cn';
import { IconButton } from '../../../../ui/icon-button';
import { SearchInput } from '../../../../ui/search-input';
import { fileIconUrl } from '../../../workspace/view';
import { chatClient } from '../client';
import { parseReviewTabId, reviewTabId } from './tab-id';
import { STATUS_TEXT, basenameOf, dirnameOf } from './view-utils';

const STATUS_MARK = {
  added: { letter: 'U', color: 'text-success' },
  modified: { letter: 'M', color: 'text-warning' },
  deleted: { letter: 'D', color: 'text-danger' },
} as const;

function ChangeStatus({ status }: { status: keyof typeof STATUS_MARK }) {
  const { letter, color } = STATUS_MARK[status];
  return (
    <span
      className={cn('shrink-0 text-ui-subhead font-semibold', color)}
      title={STATUS_TEXT[status]}
    >
      <span aria-hidden="true">{letter}</span>
      <span className="sr-only">{STATUS_TEXT[status]}</span>
    </span>
  );
}

function projectChangesQuery(projectId: string) {
  return queryOptions({
    queryKey: ['chat', 'uncommitted', projectId],
    queryFn: () => chatClient.readUncommittedChanges(projectId),
    enabled: Boolean(window.delionBot),
    staleTime: 10_000,
  });
}

export function ProjectChangeTabStatus({ tabId }: { tabId: TabId }) {
  const target = parseReviewTabId(tabId);
  return target?.kind === 'uncommitted' ? (
    <FileChangeTabStatus projectId={target.projectId} path={target.path} />
  ) : null;
}

function FileChangeTabStatus({ projectId, path }: { projectId: string; path: string }) {
  const { data: status } = useQuery({
    ...projectChangesQuery(projectId),
    select: (summary) => summary.files.find((file) => file.path === path)?.status,
  });
  return status && <ChangeStatus status={status} />;
}

export function ProjectChanges({
  projectId,
  activeTab,
  onOpen,
}: {
  projectId: string;
  activeTab: TabId | null;
  onOpen: (tabId: TabId) => void;
}) {
  const [filter, setFilter] = useState('');
  const queryClient = useQueryClient();
  const changes = useQuery(projectChangesQuery(projectId));
  const summary = changes.data;
  const query = filter.trim().toLowerCase();
  const files = summary?.files.filter((file) => file.path.toLowerCase().includes(query)) ?? [];
  let message: string | null = null;
  if (changes.error) message = errorMessage(changes.error);
  else if (!summary) message = '正在读取改动…';
  else if (!summary.available)
    message = summary.reason === 'git-unavailable' ? '未找到 Git 命令' : '此目录不是 Git 仓库';
  else if (summary.files.length === 0)
    message = summary.warnings.length ? '无法确认是否有未提交的改动' : '没有未提交的改动';
  else if (files.length === 0) message = '没有匹配的改动';

  return (
    <>
      <SearchInput
        aria-label="筛选改动"
        className="mx-2 mb-1"
        onChange={(event) => setFilter(event.target.value)}
        placeholder="筛选改动…"
        value={filter}
      />
      <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
        <div className="flex items-center justify-between pt-3 pr-1 pb-1 pl-3 text-ui-subhead text-ink-2">
          <span>改动</span>
          <IconButton
            aria-label="刷新改动"
            className="-my-1.5"
            disabled={changes.isFetching}
            onClick={() => {
              void changes.refetch();
              void queryClient.invalidateQueries({
                queryKey: ['chat', 'uncommitted-file', projectId],
              });
            }}
            size="xs"
            title="刷新改动"
          >
            <ArrowPathIcon />
          </IconButton>
        </div>
        {summary && summary.warnings.length > 0 && (
          <details className="px-3 pb-1 text-ui-subhead text-ink-2">
            <summary>部分改动未能完整读取</summary>
            {summary.warnings.map((warning) => (
              <p className="wrap-anywhere" key={warning}>
                {warning}
              </p>
            ))}
          </details>
        )}
        {message && (
          <p className="px-3 py-1 text-ui-subhead text-ink-2" role="status">
            {message}
          </p>
        )}
        <ul aria-label="改动文件列表" className="px-1 pb-1">
          {files.map((file) => {
            const tabId = reviewTabId({ kind: 'uncommitted', projectId, path: file.path });
            const name = basenameOf(file.path);
            const directory = dirnameOf(file.path);
            const icon = fileIconUrl(name);
            return (
              <li key={tabId}>
                <button
                  aria-current={activeTab === tabId || undefined}
                  className={cn(
                    'flex h-7 w-full min-w-0 cursor-default items-center gap-1.5 rounded-chip pr-2 pl-2 text-left text-ui-body outline-none transition-colors focus-visible:ring-2 focus-visible:ring-accent',
                    activeTab === tabId
                      ? 'bg-selected text-ink'
                      : 'text-ink-2 hover:bg-hover hover:text-ink',
                  )}
                  onClick={() => onOpen(tabId)}
                  title={file.path}
                  type="button"
                >
                  {icon ? (
                    <img alt="" className="size-4 shrink-0" draggable={false} src={icon} />
                  ) : (
                    <DocumentIcon aria-hidden className="size-4 shrink-0 text-ink-2" />
                  )}
                  <span className="min-w-0 truncate">{name}</span>
                  {directory && (
                    <span className="min-w-0 truncate text-ui-subhead text-ink-2">{directory}</span>
                  )}
                  <span className="ml-auto">
                    <ChangeStatus status={file.status} />
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </>
  );
}
