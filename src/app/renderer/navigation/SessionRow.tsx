import { HoverCard, HoverCardContent, HoverCardTrigger } from '../../../ui/HoverCard';
import {
  ArchiveBoxIcon as Archive,
  BookmarkIcon as Pin,
  CloudIcon as Cloud,
  FolderIcon as Folder,
} from '@heroicons/react/24/outline';
import type { RunStatus } from '../../../core/protocol/agent';
import { cn } from '../../../ui/cn';
import { useSessionRunStatus } from '../../../modules/chat/view';
import { navSubRow, rowActions, rowStatus } from './nav-styles';
import { SessionMenu } from './SessionMenu';
import { useNavigationStore } from './view';

export interface NavSessionSummary {
  id: string;
  title: string;
  updatedAt: string;
  createdAt: string;
  pinned?: boolean;
  archived?: boolean;
}
export const sessionDragType = 'application/x-delion-session';
export const projectSessionDragType = 'application/x-delion-project-session';
const rowMarker = 'grid size-control-xs shrink-0 place-items-center';
const badgeVisual: Record<RunStatus, { className: string; label: string }> = {
  pending: { className: 'bg-accent animate-pulse', label: '等待运行' },
  running: { className: 'bg-accent animate-pulse', label: '运行中' },
  waiting_input: { className: 'bg-warning', label: '等待输入' },
  completed: { className: 'bg-success', label: '已完成' },
  failed: { className: 'bg-danger', label: '运行失败' },
  stopped: { className: 'bg-ink-3', label: '已停止' },
  interrupted: { className: 'bg-ink-3', label: '已中断' },
};
export function SessionRow({
  session,
  projectId,
  projectName,
  remoteId = null,
  active = false,
  nested = false,
  onOpen,
  onMove,
  onDelete,
}: {
  session: NavSessionSummary;
  projectId: string | null;
  projectName?: string;
  remoteId?: string | null;
  active?: boolean;
  nested?: boolean;
  onOpen: (id: string) => void;
  onMove: (sessionId: string, projectId: string | null) => void;
  onDelete?: (id: string) => void | Promise<void>;
}) {
  const ProjectIcon = remoteId ? Cloud : Folder;
  const title = session.title || '新对话';
  const badge = useSessionRunStatus(session.id);
  const visual = badge === null ? null : badgeVisual[badge];
  return (
    <div
      className={navSubRow(active, nested)}
      draggable={!session.archived}
      onDragStart={(event) => {
        event.dataTransfer.setData(sessionDragType, session.id);
        if (projectId !== null) event.dataTransfer.setData(projectSessionDragType, '');
        event.dataTransfer.effectAllowed = 'move';
      }}
    >
      <HoverCard>
        <HoverCardTrigger asChild>
          <button
            aria-current={active ? 'page' : undefined}
            className="flex min-w-0 flex-1 items-center gap-2 rounded-chip text-left"
            onClick={() => {
              if (session.archived)
                useNavigationStore.getState().requestChatRestore(session.id, projectId, title);
              else onOpen(session.id);
            }}
            type="button"
          >
            {visual && (
              <span
                role="img"
                aria-label={visual.label}
                className={cn('size-1.5 shrink-0 rounded-full', visual.className)}
              />
            )}
            <span
              className={cn(
                'min-w-0 flex-1 truncate text-ui-body',
                active && 'font-medium',
                session.archived && !active && 'text-ink-4',
              )}
            >
              {title}
            </span>
          </button>
        </HoverCardTrigger>
        <HoverCardContent align="start" className="max-w-80" side="right" sideOffset={8}>
          <span className="break-words font-medium">{title}</span>
          <span className="flex items-center gap-1.5 text-ink-2">
            <ProjectIcon className="size-3.5" aria-hidden="true" />
            {projectName ?? '随聊'}
            {visual && ` · ${visual.label}`}
          </span>
        </HoverCardContent>
      </HoverCard>

      {session.archived ? (
        <span className={cn(rowMarker, 'text-ink-3')}>
          <Archive className="size-4" role="img" aria-label="已归档" />
        </span>
      ) : (
        <>
          {session.pinned && (
            <span className={cn(rowMarker, 'text-ink-2', rowStatus)}>
              <Pin className="size-4" role="img" aria-label="已置顶" />
            </span>
          )}
          <div className={rowActions}>
            <SessionMenu
              onDelete={onDelete}
              onMove={onMove}
              projectId={projectId}
              session={session}
              title={title}
            />
          </div>
        </>
      )}
    </div>
  );
}
