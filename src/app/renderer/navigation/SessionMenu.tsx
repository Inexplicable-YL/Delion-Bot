import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  ArchiveBoxIcon as Archive,
  ArrowDownTrayIcon as Download,
  ArrowTopRightOnSquareIcon as OpenTab,
  BookmarkIcon as Pin,
  BookmarkSlashIcon as PinOff,
  CloudIcon as Cloud,
  EllipsisHorizontalIcon as MoreHorizontal,
  FolderIcon as Folder,
  MinusCircleIcon as RemoveFromProject,
  PencilIcon as Pencil,
  Square2StackIcon as Copy,
} from '@heroicons/react/24/outline';
import { errorMessage } from '../../../core/protocol/contract';
import { exportSessionArchive, renameSession, updateSession } from '../../../modules/chat/view';
import { useWorkspaceStore } from '../../../modules/workspace/view';
import { Button } from '../../../ui/Button';
import { Dialog, DialogContent, DialogFooter, DialogTitle } from '../../../ui/Dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '../../../ui/DropdownMenu';
import { IconButton } from '../../../ui/IconButton';
import { Input } from '../../../ui/Input';
import { showToast } from '../../../ui/Toast';
import type { NavSessionSummary } from './SessionRow';
import { useNavigationStore } from './view';

export function SessionMenu({
  session,
  title,
  projectId,
  onMove,
  onDelete,
}: {
  session: NavSessionSummary;
  title: string;
  projectId: string | null;
  onMove: (sessionId: string, projectId: string | null) => void;
  onDelete?: (id: string) => void | Promise<void>;
}) {
  const queryClient = useQueryClient();
  const refreshArchived = () => queryClient.invalidateQueries({ queryKey: ['chat', 'archived'] });
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState('');
  const run = async (failure: string, action: () => unknown) => {
    try {
      await action();
    } catch (cause) {
      showToast({ variant: 'error', title: failure, description: errorMessage(cause) });
    }
  };
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <IconButton size="sm" aria-label={`${title} 的对话菜单`} title="对话菜单">
            <MoreHorizontal />
          </IconButton>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" side="right" className="min-w-48">
          <DropdownMenuItem
            onSelect={() => void run('会话导出失败', () => exportSessionArchive(session.id))}
          >
            <Download />
            导出会话
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={() =>
              void run('会话操作失败', () => updateSession(session.id, { pinned: !session.pinned }))
            }
          >
            {session.pinned ? <PinOff /> : <Pin />}
            {session.pinned ? '取消置顶' : '置顶'}
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={() => {
              setDraft(session.title);
              setRenaming(true);
            }}
          >
            <Pencil />
            重命名
          </DropdownMenuItem>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              <Folder />
              {projectId === null ? '添加到项目' : '移动到项目'}
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="min-w-40 max-w-64">
              <MoveTargets
                currentProjectId={projectId}
                onSelect={(target) => onMove(session.id, target)}
              />
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          {projectId !== null && (
            <DropdownMenuItem onSelect={() => onMove(session.id, null)}>
              <RemoveFromProject />
              从项目中移出
            </DropdownMenuItem>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onSelect={() =>
              void run('复制失败', async () => {
                await navigator.clipboard.writeText(session.id);
                showToast({ variant: 'success', title: '已复制对话 ID' });
              })
            }
          >
            <Copy />
            复制对话 ID
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={() => useNavigationStore.getState().openChatTab(session.id, projectId)}
          >
            <OpenTab />
            在新标签页中打开
          </DropdownMenuItem>
          {onDelete && (
            <DropdownMenuItem
              variant="destructive"
              onSelect={() =>
                void run('归档失败', async () => {
                  await onDelete(session.id);
                  await refreshArchived();
                })
              }
            >
              <Archive />
              归档
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      <Dialog open={renaming} onOpenChange={setRenaming}>
        <DialogContent size="sm">
          <DialogTitle>重命名对话</DialogTitle>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              const next = draft.trim();
              if (!next) return;
              setRenaming(false);
              void run('重命名失败', () => renameSession(session.id, next));
            }}
          >
            <Input
              aria-label="对话标题"
              className="my-4"
              value={draft}
              maxLength={60}
              onChange={(event) => setDraft(event.target.value)}
              autoFocus
            />
            <DialogFooter className="mt-0">
              <Button onClick={() => setRenaming(false)} variant="ghost">
                取消
              </Button>
              <Button type="submit" disabled={!draft.trim()}>
                保存
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

function MoveTargets({
  currentProjectId,
  onSelect,
}: {
  currentProjectId: string | null;
  onSelect: (projectId: string) => void;
}) {
  const entries = useWorkspaceStore((state) => state.workspace.entries);
  const [query, setQuery] = useState('');
  const keyword = query.trim().toLowerCase();
  const matches = entries.filter(
    (entry) => entry.kind === 'project' && entry.name.toLowerCase().includes(keyword),
  );
  return (
    <>
      <Input
        aria-label="搜索项目"
        className="h-control-xs px-2 outline-hidden"
        placeholder="搜索项目…"
        value={query}
        variant="ghost"
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={(event) => {
          if (!['ArrowDown', 'ArrowUp', 'Escape'].includes(event.key)) event.stopPropagation();
        }}
      />
      {matches.length > 0 && <DropdownMenuSeparator />}
      {matches.map((project) => {
        const Icon = project.remoteId ? Cloud : Folder;
        return (
          <DropdownMenuItem
            key={project.id}
            disabled={project.id === currentProjectId}
            onSelect={() => onSelect(project.id)}
          >
            <Icon />
            <span className="truncate">{project.name}</span>
          </DropdownMenuItem>
        );
      })}
    </>
  );
}
