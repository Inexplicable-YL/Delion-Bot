import { useState, type ReactNode } from 'react';
import { skipToken, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowPathIcon as RefreshCw,
  ArrowsRightLeftIcon as GitCompare,
  DocumentTextIcon,
  ExclamationTriangleIcon as TriangleAlert,
} from '@heroicons/react/24/outline';
import type { FileChangeDetail } from '../../../../core/protocol/agent';
import { chatClient } from '../client';
import { DiffScroller, PatchDiffView } from './pierre-diff';
import { Centered, STATUS_TEXT, basenameOf, dirnameOf } from './view-utils';
import { IconButton } from '../../../../ui/icon-button';
import { PanelHeader } from '../../../../ui/panel-header';
import { errorMessage } from '../../../../core/protocol/contract';
import { fileIconUrl } from '../../../workspace/view';

const REASON_TEXT = {
  'not-git': '此目录不是 Git 仓库',
  'git-unavailable': '未找到 Git 命令，无法读取改动',
  remote: '远程项目的改动在另一台机器上，请在远端查看',
} as const;

const STATUS_MARK = {
  added: { letter: 'U', color: 'text-success' },
  modified: { letter: 'M', color: 'text-warning' },
  deleted: { letter: 'D', color: 'text-danger' },
} as const;

function ChangeStatus({ status }: { status: FileChangeDetail['status'] }) {
  const { letter, color } = STATUS_MARK[status];
  const label = STATUS_TEXT[status];
  return (
    <span
      className={`w-4 shrink-0 text-center text-ui-subhead font-semibold ${color}`}
      title={label}
    >
      <span aria-hidden="true">{letter}</span>
      <span className="sr-only">{label}</span>
    </span>
  );
}

type ReviewDetail = Omit<FileChangeDetail, 'before' | 'after'>;
type CachedDetail = { detail: ReviewDetail; bytes: number };
// 按 UTF-16 序列化长度估算缓存体积，控制反复切换大文件时保留的文本量。
const CACHE_BYTE_LIMIT = 16 * 1024 * 1024;

export function UncommittedReview({ sessionId }: { sessionId: string }) {
  const queryClient = useQueryClient();
  const [picked, setPicked] = useState<string | null>(null);
  const changes = useQuery({
    queryKey: ['chat', 'uncommitted', sessionId],
    queryFn: () => {
      queryClient.removeQueries({ queryKey: ['chat', 'uncommitted-file', sessionId] });
      return chatClient.readUncommittedChanges(sessionId);
    },
    gcTime: 0,
  });
  const busy = changes.isFetching;
  const summary = busy ? undefined : changes.data;
  const files = summary?.files ?? [];
  const selected = files.some((file) => file.path === picked) ? picked : (files[0]?.path ?? null);
  const detailRead = useQuery({
    queryKey: ['chat', 'uncommitted-file', sessionId, selected],
    queryFn:
      summary?.available && selected
        ? async () => {
            const value = await chatClient.readUncommittedFileChange({
              sessionId,
              path: selected,
            });
            const detail: ReviewDetail = {
              path: value.path,
              status: value.status,
              beforeBytes: value.beforeBytes,
              afterBytes: value.afterBytes,
              textDiff: value.textDiff,
              patch: value.patch,
              note: value.note,
            };
            const bytes = JSON.stringify(detail).length * 2;
            const queryCache = queryClient.getQueryCache();
            const cached = queryCache
              .findAll({ queryKey: ['chat', 'uncommitted-file', sessionId] })
              .filter((query) => query.state.data !== undefined)
              .sort((a, b) => a.state.dataUpdatedAt - b.state.dataUpdatedAt);
            let total = cached.reduce(
              (sum, query) => sum + (query.state.data as CachedDetail).bytes,
              0,
            );
            for (const query of cached) {
              if (total + bytes <= CACHE_BYTE_LIMIT) break;
              total -= (query.state.data as CachedDetail).bytes;
              queryCache.remove(query);
            }
            return { detail, bytes };
          }
        : skipToken,
    select: (cached) => cached.detail,
    staleTime: Infinity,
  });
  const detail = detailRead.data;
  const detailError = detailRead.error ? errorMessage(detailRead.error) : null;

  const shell = (children: ReactNode) => (
    <section aria-label="工作区改动" className="flex min-h-0 min-w-0 flex-1 flex-col bg-surface">
      <PanelHeader>
        <GitCompare aria-hidden className="size-4 shrink-0 text-ink-2" />
        <span className="shrink-0 text-ui-headline">工作区改动</span>
        <span
          className="min-w-0 truncate text-ui-subhead text-ink-2"
          title={summary?.repositoryRoot ?? undefined}
        >
          {summary?.available ? `${files.length} 个文件` : ''}
        </span>
        <IconButton
          aria-label="刷新改动"
          className="ml-auto"
          disabled={busy}
          onClick={() => void changes.refetch()}
          title="重新读取工作区改动"
        >
          <RefreshCw className={busy ? 'animate-spin' : undefined} />
        </IconButton>
      </PanelHeader>
      {summary && summary.warnings.length > 0 && (
        <div
          aria-label="读取警告"
          className="max-h-32 shrink-0 overflow-auto border-b border-line px-3 py-2 text-ui-subhead text-ink-2"
          role="status"
        >
          <p>部分改动未能完整读取：</p>
          {summary.warnings.map((warning, index) => (
            <p key={index}>{warning}</p>
          ))}
        </div>
      )}
      {children}
    </section>
  );

  if (changes.error && !busy)
    return shell(
      <Centered>
        <TriangleAlert aria-hidden className="size-4 text-ink-2" />
        {errorMessage(changes.error)}
      </Centered>,
    );
  if (!summary) return shell(<Centered role="status">正在读取改动…</Centered>);
  if (!summary.available)
    return shell(<Centered>{REASON_TEXT[summary.reason ?? 'not-git']}</Centered>);
  if (files.length === 0)
    return shell(
      <Centered>
        {summary.warnings.length > 0
          ? '无法确认工作区是否存在未提交的改动'
          : '工作区没有未提交的改动'}
      </Centered>,
    );

  return shell(
    <div className="flex min-h-0 flex-1">
      <aside
        aria-label="改动文件列表"
        className="w-60 shrink-0 overflow-y-auto border-r border-line py-1"
      >
        {files.map((file) => {
          const name = basenameOf(file.path);
          const iconUrl = fileIconUrl(name);
          return (
            <button
              aria-current={selected === file.path ? 'true' : undefined}
              className={`flex w-full min-w-0 items-center gap-2 px-3 py-1.5 text-left text-ui-body transition-colors duration-fast hover:bg-hover ${
                selected === file.path ? 'bg-hover' : ''
              }`}
              key={file.path}
              onClick={() => setPicked(file.path)}
              title={file.path}
              type="button"
            >
              {iconUrl ? (
                <img alt="" className="size-4 shrink-0" draggable={false} src={iconUrl} />
              ) : (
                <DocumentTextIcon aria-hidden className="size-4 shrink-0 text-ink-2" />
              )}
              <span className="min-w-0 truncate">{name}</span>
              <span className="min-w-0 flex-1 truncate text-ui-subhead text-ink-2">
                {dirnameOf(file.path)}
              </span>
              <ChangeStatus status={file.status} />
            </button>
          );
        })}
      </aside>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        {detailError ? (
          <Centered>{detailError}</Centered>
        ) : detail ? (
          <>
            <div className="flex shrink-0 items-center gap-2 px-3 py-2">
              <span className="text-ui-headline">{basenameOf(detail.path)}</span>
              <ChangeStatus status={detail.status} />
              {detail.note && (
                <span className="min-w-0 truncate text-ui-subhead text-ink-2">{detail.note}</span>
              )}
            </div>
            {detail.patch ? (
              <DiffScroller>
                <PatchDiffView patch={detail.patch} />
              </DiffScroller>
            ) : (
              <Centered>此文件没有可展示的文本差异</Centered>
            )}
          </>
        ) : (
          <Centered role="status">正在读取差异…</Centered>
        )}
      </div>
    </div>,
  );
}
