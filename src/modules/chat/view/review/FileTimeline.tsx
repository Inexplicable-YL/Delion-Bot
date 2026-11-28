import { useId, useState } from 'react';
import { skipToken, useQuery } from '@tanstack/react-query';
import { ArrowPathIcon, BookmarkIcon } from '@heroicons/react/24/outline';
import { BookmarkIcon as BookmarkSolidIcon } from '@heroicons/react/24/solid';
import type { TabId } from '../../../../app/module';
import { errorMessage } from '../../../../core/protocol/contract';
import { cn } from '../../../../ui/cn';
import { CollapseChevron } from '../../../../ui/Collapse';
import { IconButton } from '../../../../ui/IconButton';
import { chatClient } from '../client';
import { reviewTabId } from './tab-id';
import { basenameOf } from './ViewUtils';

const timeFormat = new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'medium' });
const dateFormat = new Intl.DateTimeFormat('zh-CN', { month: 'short', day: 'numeric' });
const relativeFormat = new Intl.RelativeTimeFormat('zh-CN', { numeric: 'auto', style: 'short' });

function relativeTime(at: number, now: number): string {
  const seconds = Math.floor(Math.max(0, now - at) / 1000);
  if (seconds < 5) return '现在';
  if (seconds < 60) return relativeFormat.format(-seconds, 'second');
  if (seconds < 3600) return relativeFormat.format(-Math.floor(seconds / 60), 'minute');
  if (seconds < 86_400) return relativeFormat.format(-Math.floor(seconds / 3600), 'hour');
  if (seconds < 604_800) return relativeFormat.format(-Math.floor(seconds / 86_400), 'day');
  return dateFormat.format(at);
}

export function FileTimeline({
  selectedPath,
  activeTab,
  onOpen,
}: {
  selectedPath: string | null;
  activeTab: TabId | null;
  onOpen: (tabId: TabId) => void;
}) {
  const [open, setOpen] = useState(false);
  const [pinnedPath, setPinnedPath] = useState<string | null>(null);
  const path = pinnedPath ?? selectedPath;
  const listId = useId();
  const timeline = useQuery({
    queryKey: ['chat', 'fileTimeline', path],
    queryFn: path === null ? skipToken : () => chatClient.fileTimeline({ path }),
    enabled: open && path !== null && Boolean(window.delionBot),
    refetchInterval: 30_000,
  });
  const data = timeline.data;
  const now = timeline.dataUpdatedAt;
  const pinLabel = pinnedPath ? '取消固定时间线' : '固定时间线';
  let message: string | null = null;
  if (path === null) message = '选中一个文件以查看时间线';
  else if (timeline.error) message = errorMessage(timeline.error);
  else if (data === undefined) message = '正在读取时间线…';
  else if (data === null || data.entries.length === 0) message = '这个文件没有版本记录';

  return (
    <section aria-label="时间线" className="shrink-0 border-t border-line">
      <div className="flex items-center gap-1 px-2 py-1">
        <h2 className="min-w-0 flex-1">
          <button
            aria-controls={listId}
            aria-expanded={open}
            className="flex min-h-control-xs w-full items-center gap-1 rounded-control px-1 text-left touch:min-h-control-lg"
            onClick={() => setOpen((value) => !value)}
            type="button"
          >
            <CollapseChevron className="text-ink-2" open={open} />
            <span className="flex min-w-0 flex-wrap items-center gap-x-1">
              <span className="shrink-0 text-ui-callout text-ink">时间线</span>
              {path && (
                <span className="max-w-full truncate text-ui-caption text-ink-2" title={path}>
                  {basenameOf(path)}
                </span>
              )}
            </span>
          </button>
        </h2>
        {open && (
          <>
            <IconButton
              aria-label={pinLabel}
              aria-pressed={pinnedPath !== null}
              className="aria-pressed:bg-transparent aria-pressed:hover:bg-hover [&_svg]:size-3.5"
              disabled={path === null}
              onClick={() => setPinnedPath(pinnedPath ? null : path)}
              size="xs"
              title={pinLabel}
            >
              {pinnedPath ? <BookmarkSolidIcon /> : <BookmarkIcon />}
            </IconButton>
            <IconButton
              aria-label="刷新时间线"
              className="[&_svg]:size-3.5"
              disabled={path === null || !window.delionBot}
              onClick={() => void timeline.refetch({ cancelRefetch: false })}
              size="xs"
              title="刷新时间线"
            >
              <ArrowPathIcon />
            </IconButton>
          </>
        )}
      </div>
      <div
        className="max-h-56 overflow-y-auto pb-1"
        data-slot="file-timeline-content"
        hidden={!open}
        id={listId}
      >
        {message && (
          <p className="px-3 py-1 text-ui-subhead text-ink-2" role="status">
            {message}
          </p>
        )}
        {open && data && data.entries.length > 0 && (
          <ul aria-label="文件时间线">
            {data.entries.map((entry) => {
              const at = Date.parse(entry.at);
              const tabId = reviewTabId({
                kind: 'version',
                sessionId: data.sessionId,
                fromEventId: entry.fromEventId,
                toEventId: entry.toEventId,
                path: data.path,
              });
              return (
                <li key={entry.toEventId}>
                  <button
                    aria-current={activeTab === tabId || undefined}
                    className={cn(
                      'flex min-h-control-xs w-full items-center gap-1 rounded-control py-1 pr-3 pl-4 text-left text-ui-callout text-ink hover:bg-hover touch:min-h-control-lg',
                      activeTab === tabId && 'bg-selected hover:bg-selected',
                    )}
                    onClick={() => onOpen(tabId)}
                    type="button"
                  >
                    <span
                      aria-hidden
                      className="size-2 shrink-0 rounded-full border border-ink-2"
                    />
                    <span className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-2">
                      <span className="min-w-0">
                        已保存文件
                        {entry.source.kind === 'agent' && (
                          <span className="whitespace-nowrap">（Agent）</span>
                        )}
                      </span>
                      <time
                        className="ml-auto text-ui-subhead whitespace-nowrap tabular-nums text-ink-2"
                        dateTime={entry.at}
                        title={timeFormat.format(at)}
                      >
                        {relativeTime(at, now)}
                      </time>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}
