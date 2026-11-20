import { useState } from 'react';
import { Button } from '../../../ui/button';
import { useDismissOnOutsidePointer } from '../../../ui/use-dismiss-on-outside-pointer';
import { HoverCard, HoverCardContent, HoverCardTrigger } from '../../../ui/hover-card';
import {
  ArchiveBoxIcon as Archive,
  BookmarkIcon as Pin,
  BookmarkSlashIcon as PinOff,
  CloudIcon as Cloud,
  FolderIcon as Folder,
} from '@heroicons/react/24/outline';
import type { RunStatus } from '../../../core/protocol/agent';
import { cn } from '../../../ui/cn';
import { useSessionRunStatus, updateSession } from '../../../modules/chat/view';
import { showToast } from '../../../ui/toast';
import { navSubRow, rowActions, rowStatus } from './nav-styles';
import { IconButton } from '../../../ui/icon-button';
import { errorMessage } from '../../../core/protocol/contract';

export interface NavSessionSummary {
  id: string;
  title: string;
  updatedAt: string;
  pinned?: boolean;
}
export type SessionRunBadge = RunStatus | null;
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
  projectName,
  remoteId = null,
  active = false,
  onOpen,
  onDelete,
}: {
  session: NavSessionSummary;
  projectName?: string;
  remoteId?: string | null;
  badge?: SessionRunBadge;
  active?: boolean;
  onOpen: (id: string) => void;
  onDelete?: (id: string) => void | Promise<void>;
}) {
  const ProjectIcon = remoteId ? Cloud : Folder;
  const title = session.title || '新对话';
  const badge = useSessionRunStatus(session.id);
  const visual = badge === null ? null : badgeVisual[badge];
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  useDismissOnOutsidePointer(confirming, '[data-archive-confirm]', () => setConfirming(false), {
    escape: true,
  });
  const change = async (archive: boolean) => {
    if (busy) return;
    if (archive && !confirming) {
      setConfirming(true);
      return;
    }
    setConfirming(false);
    setBusy(true);
    try {
      if (archive) {
        if (onDelete) await onDelete(session.id);
      } else await updateSession(session.id, { pinned: !session.pinned });
    } catch (cause) {
      showToast({ variant: 'error', title: '会话操作失败', description: errorMessage(cause) });
    }
    setBusy(false);
  };
  return (
    <div className={navSubRow(active)}>
      <HoverCard>
        <HoverCardTrigger asChild>
          <button
            aria-current={active ? 'page' : undefined}
            className="flex min-w-0 flex-1 items-center gap-2 rounded-chip text-left"
            onClick={() => onOpen(session.id)}
            type="button"
          >
            {visual && (
              <span
                role="img"
                aria-label={visual.label}
                className={cn('size-1.5 shrink-0 rounded-full', visual.className)}
              />
            )}
            <span className={cn('min-w-0 flex-1 truncate text-ui-body', active && 'font-medium')}>
              {title}
            </span>
            {session.pinned && (
              <Pin className={cn('size-4 shrink-0 text-ink-2', rowStatus)} aria-label="已置顶" />
            )}
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
      {confirming ? (
        <Button
          data-archive-confirm=""
          size="sm"
          variant="destructive"
          className="h-6 px-2 text-ui-subhead"
          disabled={busy}
          onBlur={() => setConfirming(false)}
          onClick={() => void change(true)}
        >
          确认归档
        </Button>
      ) : (
        <div className={rowActions}>
          <IconButton
            size="sm"
            disabled={busy}
            aria-label={`${session.pinned ? '取消置顶' : '置顶'} ${title}`}
            title={session.pinned ? '取消置顶' : '置顶'}

            onClick={() => void change(false)}
          >
            {session.pinned ? <PinOff /> : <Pin />}
          </IconButton>
          {onDelete && (
            <IconButton
              size="sm"
              disabled={busy}
              aria-label={`归档 ${title}`}
              title="归档对话"

              onClick={() => void change(true)}
            >
              <Archive />
            </IconButton>
          )}
        </div>
      )}
    </div>
  );
}
