import { useQuery } from '@tanstack/react-query';
import type { TabId } from '../../../../app/module';
import { errorMessage } from '../../../../core/protocol/contract';
import { cn } from '../../../../ui/cn';
import { chatClient } from '../client';
import { reviewTabId } from './tab-id';
import { STATUS_TEXT } from './ViewUtils';

type Timeline = NonNullable<Awaited<ReturnType<typeof chatClient.fileTimeline>>>;

const timeFormat = new Intl.DateTimeFormat('zh-CN', {
  month: 'short',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

function sourceLabel(source: Timeline['entries'][number]['source']): string {
  if (source.kind === 'user') return '用户';
  if (source.kind === 'revert') return '重试前撤销';
  const title = source.title ?? '已删除的会话';
  return source.kind === 'turn' ? `模型 · ${title}` : `分支自 ${title}`;
}

export function FileTimeline({
  path,
  updatedAt,
  activeTab,
  onOpen,
}: {
  path: string | null;
  updatedAt: string | null;
  activeTab: TabId | null;
  onOpen: (tabId: TabId) => void;
}) {
  const timeline = useQuery({
    queryKey: ['chat', 'file-timeline', path, updatedAt],
    queryFn: () => chatClient.fileTimeline({ path: path! }),
    enabled: path !== null && Boolean(window.delionBot),
  });
  let message: string | null = null;
  if (path === null) message = '选中一个文件以查看时间线';
  else if (timeline.error) message = errorMessage(timeline.error);
  else if (timeline.data === undefined) message = '正在读取时间线…';
  else if (timeline.data === null) message = '这个文件没有版本记录';
  else if (timeline.data.entries.length === 0) message = '还没有记录到改动';

  return (
    <div className="max-h-56 overflow-y-auto pb-1">
      {message && (
        <p className="px-3 py-1 text-ui-subhead text-ink-2" role="status">
          {message}
        </p>
      )}
      {timeline.data && path !== null && (
        <ul aria-label="文件时间线" className="px-1">
          {timeline.data.entries.map((entry) => {
            const tabId = reviewTabId({
              kind: 'version',
              sessionId: timeline.data!.sessionId,
              eventId: entry.eventId,
              path: timeline.data!.path,
            });
            return (
              <li key={entry.eventId}>
                <button
                  aria-current={activeTab === tabId || undefined}
                  className={cn(
                    'flex h-7 w-full min-w-0 cursor-default items-center gap-1.5 rounded-chip px-2 text-left text-ui-body outline-none transition-colors focus-visible:ring-2 focus-visible:ring-accent',
                    activeTab === tabId
                      ? 'bg-selected text-ink'
                      : 'text-ink-2 hover:bg-hover hover:text-ink',
                  )}
                  onClick={() => onOpen(tabId)}
                  type="button"
                >
                  <span className="min-w-0 flex-1 truncate">
                    {sourceLabel(entry.source)} · {STATUS_TEXT[entry.status]}
                  </span>
                  <span className="shrink-0 text-ui-subhead tabular-nums text-ink-3">
                    {timeFormat.format(new Date(entry.at))}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
