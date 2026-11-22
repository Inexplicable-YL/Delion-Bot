import { useState, type DragEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '../../../ui/Button';
import { useDismissOnOutsidePointer } from '../../../ui/use-dismiss-on-outside-pointer';
import { CollapseChevron } from '../../../ui/Collapse';
import { Tooltip, TooltipContent, TooltipTrigger } from '../../../ui/Tooltip';
import {
  ArchiveBoxIcon as Archive,
  BookmarkIcon as Pin,
  BookmarkSlashIcon as PinOff,
  CloudIcon as Cloud,
  EllipsisHorizontalIcon as MoreHorizontal,
  FolderIcon as Folder,
  FolderOpenIcon as FolderOpen,
  ListBulletIcon as List,
  PencilIcon as Pencil,
  PlusIcon as Plus,
  TrashIcon as Trash2,
} from '@heroicons/react/24/outline';
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
import { EntryDialogs, type EntryDialogRequest } from '../workspace/EntryDialogs';
import { cn } from '../../../ui/cn';
import type { WorkspaceEntry } from '../../../modules/workspace/contract';
import { remoteAccent } from '../../../modules/remotes/view';
import { useVisibleNavEntries, type NavEntryId } from './entries';
import { showToast } from '../../../ui/Toast';
import {
  SessionRow,
  projectSessionDragType,
  sessionDragType,
  type NavSessionSummary,
} from './SessionRow';
import {
  usePreferences,
  type ChatListSort,
  type NavListPreference,
  type ProjectListSort,
} from '../shell/preferences';
import { activitySince, NavListHeader, type NavListOptions } from './NavListHeader';
import { useTreeState } from './store';
import { refreshSessionLists, chatClient, moveSession } from '../../../modules/chat/view';
import { closeTabEverywhere } from '../workbench/layout-store';
import { Input } from '../../../ui/Input';
import { purgeRemovedEntries } from '../workbench/removed-cleanup';
import { navIcon, navRow, navSectionTitle, rowActions, rowEndInset } from './nav-styles';
import { NewChatIcon } from './NewChatIcon';
import { useRemoteActivity } from './remote-activity';
import { RemoteConnectionTip } from './RemoteConnectionTip';
import { useRemoteConnections } from './remote-connections';
import { IconButton } from '../../../ui/IconButton';
import { workspaceClient, useWorkspaceStore } from '../../../modules/workspace/view';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from '../../../ui/Dialog';
import { errorMessage } from '../../../core/protocol/contract';

const fileManagerName = window.delionBot?.platform === 'darwin' ? 'Finder' : '资源管理器';

export type { NavSessionSummary };

export type BusinessNavId = Exclude<NavEntryId, 'sources'>;

const RECENT_SESSIONS = 3;
const chatSortOptions: NavListOptions<ChatListSort> = [
  ['updated', '最后活动'],
  ['created', '创建时间'],
];
const projectSortOptions: NavListOptions<ProjectListSort> = [
  ['updated', '最后活动'],
  ['name', '名称'],
];

export function ProjectSessionNav({
  sessionsByProject,
  generalSessions,
  onOpenSession,
  onDeleteSession,
  activeSessionId = null,
  onOpenProject,
  onNewProject,
  onNewChat,
  onNewGeneralChat,
  onOpenSources,
  sourcesActive = false,
  activeProjectId = null,
  onNavigateBusiness,
  activeBusinessId = null,
}: {
  sessionsByProject: Record<string, NavSessionSummary[]>;
  generalSessions: NavSessionSummary[];
  onOpenSession: (sessionId: string) => void;
  onDeleteSession?: (sessionId: string) => void;
  activeSessionId?: string | null;
  onOpenProject: (projectId: string) => void;
  onNewProject: () => void;
  onNewChat?: (projectId: string | null) => void;
  onNewGeneralChat: () => void;
  onOpenSources?: () => void;
  sourcesActive?: boolean;
  activeProjectId?: string | null;
  onNavigateBusiness?: (id: BusinessNavId) => void;
  activeBusinessId?: NavEntryId | null;
}) {
  const entries = useWorkspaceStore((s) => s.workspace.entries);
  const visibleEntries = useVisibleNavEntries().filter((entry) => entry.id !== 'connectors');
  const openProjects = useTreeState((s) => s.openProjects);
  const toggleProject = useTreeState((s) => s.toggleProject);
  const fullSessionLists = useTreeState((s) => s.fullSessionLists);
  const toggleFullSessionList = useTreeState((s) => s.toggleFullSessionList);
  const preferences = usePreferences((state) => state.projectNav);
  const setProjectPreference = usePreferences((state) => state.patchProjectNav);
  const chatList = usePreferences((state) => state.chatList);
  const projectList = usePreferences((state) => state.projectList);
  const patchNavList = usePreferences((state) => state.patchNavList);
  const queryClient = useQueryClient();
  const archived = useQuery({
    queryKey: ['chat', 'archived'],
    queryFn: () => chatClient.archived(),
    enabled:
      Boolean(window.delionBot) &&
      (chatList.status !== 'active' || projectList.status !== 'active'),
  });
  const archivedIn = (projectId: string | null): NavSessionSummary[] =>
    (archived.data ?? [])
      .filter((session) => session.projectId === projectId)
      .map((session) => ({ ...session, pinned: false, archived: true }));
  const byStatus = (
    status: NavListPreference<string>['status'],
    active: NavSessionSummary[],
    projectId: string | null,
  ) => [
    ...(status === 'archived' ? [] : active),
    ...(status === 'active' ? [] : archivedIn(projectId)),
  ];
  const sessionsOf = (projectId: string) =>
    byStatus(projectList.status, sessionsByProject[projectId] ?? [], projectId);
  const chatsSince = activitySince(chatList.activityDays);
  const listedChats = byStatus(chatList.status, generalSessions, null)
    .filter((session) => !session.pinned && Date.parse(session.updatedAt) >= chatsSince)
    .toSorted((a, b) =>
      chatList.sort === 'created'
        ? b.createdAt.localeCompare(a.createdAt)
        : b.updatedAt.localeCompare(a.updatedAt),
    );
  const projects = entries
    .filter((entry) => entry.kind === 'project')
    .sort(
      (a, b) =>
        Number(Boolean(preferences[b.id]?.pinned)) - Number(Boolean(preferences[a.id]?.pinned)),
    );
  const lastActivity = (project: WorkspaceEntry) =>
    sessionsOf(project.id).reduce(
      (latest, session) => (session.updatedAt > latest ? session.updatedAt : latest),
      project.updatedAt,
    );
  const projectsSince = activitySince(projectList.activityDays);
  const listedProjects = projects
    .filter(
      (project) =>
        !preferences[project.id]?.pinned && Date.parse(lastActivity(project)) >= projectsSince,
    )
    .toSorted((a, b) =>
      projectList.sort === 'name'
        ? a.name.localeCompare(b.name)
        : lastActivity(b).localeCompare(lastActivity(a)),
    );
  const connections = useRemoteConnections();
  const activity = useRemoteActivity((state) => state.byProject);
  const [entryRequest, setEntryRequest] = useState<EntryDialogRequest | null>(null);
  const [sectionProjectId, setSectionProjectId] = useState<string | null>(null);
  const [sectionName, setSectionName] = useState('');
  const [archiving, setArchiving] = useState(false);
  const [confirmArchive, setConfirmArchive] = useState<string | null>(null);
  const dismissArchiveRef = useDismissOnOutsidePointer(
    confirmArchive !== null,
    '[data-archive-confirm]',
    () => setConfirmArchive(null),
  );
  const sectionNames = [
    ...new Set(
      Object.values(preferences)
        .map((pref) => pref.section)
        .filter((name): name is string => Boolean(name)),
    ),
  ];
  const runAction = async (title: string, action: () => Promise<unknown>) => {
    try {
      await action();
    } catch (cause) {
      showToast({ variant: 'error', title, description: errorMessage(cause) });
    }
  };
  const [dropTarget, setDropTarget] = useState<{ projectId: string | null } | null>(null);
  const isDropTarget = (projectId: string | null) => dropTarget?.projectId === projectId;
  const ownerOf = (sessionId: string): string | null | undefined =>
    generalSessions.some((session) => session.id === sessionId)
      ? null
      : Object.keys(sessionsByProject).find((id) =>
          sessionsByProject[id]!.some((session) => session.id === sessionId),
        );
  const moveChat = (sessionId: string, projectId: string | null) =>
    void runAction('移动对话失败', async () => {
      await moveSession(sessionId, projectId);
      await queryClient.invalidateQueries({ queryKey: ['chat', 'archived'] });
      closeTabEverywhere(`chat:${sessionId}`);
      if (projectId) toggleProject(projectId, true);
      if (sessionId === activeSessionId) onOpenSession(sessionId);
    });
  const dropZone = (projectId: string | null) => ({
    onDragOver: (event: DragEvent) => {
      const { types } = event.dataTransfer;
      if (!types.includes(sessionDragType)) return;
      if (projectId === null && types.includes(projectSessionDragType)) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = 'move';
      if (!isDropTarget(projectId)) setDropTarget({ projectId });
    },
    onDragLeave: (event: DragEvent) => {
      if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropTarget(null);
    },
    onDrop: (event: DragEvent) => {
      setDropTarget(null);
      const sessionId = event.dataTransfer.getData(sessionDragType);
      const owner = ownerOf(sessionId);
      if (owner === undefined || owner === projectId || (projectId === null && owner !== null))
        return;
      event.preventDefault();
      moveChat(sessionId, projectId);
    },
  });

  const sessionGroup = (
    project: WorkspaceEntry,
    sessions: NavSessionSummary[],
    groupActive: boolean,
  ) => {
    const key = project.id;
    const label = project.name;
    const accent = project.remoteId ? { color: remoteAccent(project.remoteId, 'text') } : undefined;
    const expanded = openProjects.includes(key);
    const Icon = project.remoteId ? Cloud : expanded ? FolderOpen : Folder;
    const full = fullSessionLists.includes(key);
    const unpinned = sessions.filter((session) => !session.pinned);
    const visible = full ? unpinned : unpinned.slice(0, RECENT_SESSIONS);
    const shownActiveSession =
      expanded && visible.some((session) => session.id === activeSessionId);
    const rowActive =
      groupActive &&
      !shownActiveSession &&
      !sessions.some((session) => session.pinned && session.id === activeSessionId);
    const labelButton = (
      <button
        aria-current={rowActive ? 'page' : undefined}
        aria-expanded={expanded}
        className="flex min-w-0 flex-1 items-center gap-2.5 rounded-chip text-left"
        onClick={() => toggleProject(key)}
        title={project.remoteId ? undefined : label}
        type="button"
      >
        <span className="grid size-5 shrink-0 place-items-center">
          <Icon
            className={cn(
              navIcon(rowActive),
              'size-4 group-hover:hidden group-has-focus-visible:hidden',
            )}
            style={accent}
          />
          <CollapseChevron
            className="hidden text-ink-2 group-hover:block group-has-focus-visible:block"
            open={expanded}
          />
        </span>
        <span className="min-w-0 flex-1 truncate">{label}</span>
      </button>
    );
    return (
      <div key={key} className="grid min-w-0 gap-px" {...dropZone(key)}>
        <div
          className={cn(
            navRow(rowActive),
            'group',
            rowEndInset,
            isDropTarget(key) && 'bg-accent-tint text-ink',
          )}
        >
          {project.remoteId ? (
            <Tooltip>
              <TooltipTrigger asChild>{labelButton}</TooltipTrigger>
              <TooltipContent side="right" className="px-2.5 py-2">
                <RemoteConnectionTip
                  activity={activity[project.id]}
                  connection={connections[project.remoteId]}
                  project={project}
                />
              </TooltipContent>
            </Tooltip>
          ) : (
            labelButton
          )}
          <div className={rowActions}>
            {onNewChat && (
              <IconButton
                size="sm"
                aria-label={`在 ${label} 中新建对话`}
                title="新对话"
                onClick={() => onNewChat(key)}
              >
                <Plus />
              </IconButton>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <IconButton size="sm" aria-label={`${label} 的项目菜单`} title="项目菜单">
                  <MoreHorizontal />
                </IconButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" side="right" className="w-56">
                <DropdownMenuItem onSelect={() => onOpenProject(key)}>
                  <FolderOpen />
                  打开项目
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={() => setProjectPreference(key, { pinned: !preferences[key]?.pinned })}
                >
                  {preferences[key]?.pinned ? <PinOff /> : <Pin />}
                  {preferences[key]?.pinned ? '取消置顶' : '置顶'}
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => setEntryRequest({ action: 'rename', id: key })}>
                  <Pencil />
                  编辑项目
                </DropdownMenuItem>
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger>
                    <List />
                    分组
                  </DropdownMenuSubTrigger>
                  <DropdownMenuSubContent className="min-w-40">
                    <DropdownMenuItem onSelect={() => setProjectPreference(key, { section: '' })}>
                      默认分组
                    </DropdownMenuItem>
                    {sectionNames.map((name) => (
                      <DropdownMenuItem
                        key={name}
                        onSelect={() => setProjectPreference(key, { section: name })}
                      >
                        {name}
                      </DropdownMenuItem>
                    ))}
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      onSelect={() => {
                        setSectionProjectId(key);
                        setSectionName('');
                      }}
                    >
                      <Plus />
                      新建分组
                    </DropdownMenuItem>
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
                <DropdownMenuItem
                  onSelect={() =>
                    void runAction('打开目录失败', async () => workspaceClient.openLocal(key))
                  }
                >
                  <FolderOpen />在 {fileManagerName} 中显示
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem disabled={archiving} onSelect={() => setConfirmArchive(key)}>
                  <Archive />
                  归档项目对话
                </DropdownMenuItem>
                <DropdownMenuItem
                  variant="destructive"
                  onSelect={() => setEntryRequest({ action: 'remove', id: key })}
                >
                  <Trash2 />
                  移除项目
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
        {confirmArchive === key && (
          <div className="flex items-center gap-2 py-1 pl-8">
            <Button
              data-archive-confirm=""
              size="sm"
              variant="destructive"
              disabled={archiving}
              onClick={() =>
                void runAction('归档失败', async () => {
                  if (!window.delionBot) throw new Error('会话管理仅在桌面端可用');
                  setArchiving(true);
                  try {
                    const ids = await chatClient.archiveProject(key);
                    ids.forEach((id) => closeTabEverywhere(`chat:${id}`));
                    await refreshSessionLists();
                    setConfirmArchive(null);
                  } catch (cause) {
                    setArchiving(false);
                    throw cause;
                  }
                  setArchiving(false);
                })
              }
            >
              确认归档全部对话
            </Button>
          </div>
        )}
        {expanded && (
          <div className="grid grid-cols-1 gap-px pb-1">
            {sessions.length === 0 && (
              <p className="flex min-h-row-compact touch:min-h-row-regular items-center pl-8 text-ui-body text-ink-4">
                尚无对话
              </p>
            )}
            {visible.map((session) => (
              <SessionRow
                projectId={key}
                projectName={label}
                remoteId={project.remoteId}
                active={session.id === activeSessionId}
                key={session.id}
                onMove={moveChat}
                nested
                onDelete={onDeleteSession}
                onOpen={onOpenSession}
                session={session}
              />
            ))}
            {unpinned.length > RECENT_SESSIONS && (
              <button
                className="flex h-7 items-center rounded-control pl-8 pr-2 text-left text-ui-subhead text-ink-2 transition-colors duration-base hover:bg-hover hover:text-ink-2"
                onClick={() => toggleFullSessionList(key)}
                type="button"
              >
                {full ? '收起' : `显示更多（${unpinned.length - RECENT_SESSIONS}）`}
              </button>
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <Button
        className="mb-2 h-control-md shrink-0 justify-start gap-2.5 px-2"
        onClick={onNewGeneralChat}
        size={null}
        variant="glass"
      >
        <NewChatIcon className="size-5" />
        <span className="truncate">新建聊天</span>
      </Button>
      <nav aria-label="功能入口" className="grid shrink-0 gap-px" ref={dismissArchiveRef}>
        {visibleEntries.map((item) => {
          const Icon = item.icon;
          const active = item.id === 'sources' ? sourcesActive : item.id === activeBusinessId;
          return (
            <button
              aria-current={active ? 'page' : undefined}
              className={navRow(active)}
              key={item.id}
              onClick={() =>
                item.id === 'sources' ? onOpenSources?.() : onNavigateBusiness?.(item.id)
              }
              type="button"
            >
              <Icon className={navIcon(active)} />
              <span className="truncate">{item.label}</span>
            </button>
          );
        })}
      </nav>
      {(projects.some((project) => preferences[project.id]?.pinned) ||
        projects.some((project) =>
          sessionsByProject[project.id]?.some((session) => session.pinned),
        ) ||
        generalSessions.some((session) => session.pinned)) && (
        <section aria-label="置顶" className="mt-5 grid shrink-0 gap-px">
          <p className={navSectionTitle}>置顶</p>
          {projects
            .filter((project) => preferences[project.id]?.pinned)
            .map((project) =>
              sessionGroup(project, sessionsOf(project.id), project.id === activeProjectId),
            )}
          {projects.flatMap((project) =>
            (sessionsByProject[project.id] ?? [])
              .filter((session) => session.pinned)
              .map((session) => (
                <SessionRow
                  key={session.id}
                  session={session}
                  projectId={project.id}
                  projectName={project.name}
                  remoteId={project.remoteId}
                  active={session.id === activeSessionId}
                  onMove={moveChat}
                  onOpen={onOpenSession}
                  onDelete={onDeleteSession}
                />
              )),
          )}
          {generalSessions
            .filter((session) => session.pinned)
            .map((session) => (
              <SessionRow
                key={session.id}
                session={session}
                projectId={null}
                active={session.id === activeSessionId}
                onMove={moveChat}
                onOpen={onOpenSession}
                onDelete={onDeleteSession}
              />
            ))}
        </section>
      )}
      <div className="mt-5 min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
        <section
          aria-labelledby="project-session-nav-title"
          className="group/list grid content-start gap-px"
        >
          <NavListHeader
            createLabel="新建项目"
            onChange={(patch) => patchNavList('projectList', patch)}
            onCreate={listedProjects.length > 0 ? onNewProject : undefined}
            preference={projectList}
            sortLabel="按以下方式排序项目"
            sortOptions={projectSortOptions}
            title="项目"
            titleId="project-session-nav-title"
          />
          {!projectList.collapsed &&
            ['', ...sectionNames].map((section) => {
              const sectionProjects = listedProjects.filter(
                (project) => (preferences[project.id]?.section ?? '') === section,
              );
              return (
                <div key={section} className="min-w-0">
                  {section && sectionProjects.length > 0 && (
                    <p className={cn(navSectionTitle, 'pt-3 font-normal')}>{section}</p>
                  )}
                  {sectionProjects.map((project) =>
                    sessionGroup(project, sessionsOf(project.id), project.id === activeProjectId),
                  )}
                </div>
              );
            })}
          {!projectList.collapsed && listedProjects.length === 0 && (
            <button className={navRow(false)} onClick={onNewProject} type="button">
              <span className="grid size-5 shrink-0 place-items-center">
                <Plus className="size-4" />
              </span>
              新项目
            </button>
          )}
        </section>
        <section
          aria-labelledby="general-session-nav-title"
          className={cn(
            'group/list mt-5 grid content-start gap-px rounded-control pb-1',
            isDropTarget(null) && 'bg-accent-tint',
          )}
          {...dropZone(null)}
        >
          <NavListHeader
            createLabel="新建聊天"
            onChange={(patch) => patchNavList('chatList', patch)}
            onCreate={onNewGeneralChat}
            preference={chatList}
            sortLabel="按以下方式排序聊天"
            sortOptions={chatSortOptions}
            title="聊天"
            titleId="general-session-nav-title"
          />
          {!chatList.collapsed &&
            listedChats.map((session) => (
              <SessionRow
                key={session.id}
                session={session}
                projectId={null}
                active={session.id === activeSessionId}
                onMove={moveChat}
                onOpen={onOpenSession}
                onDelete={onDeleteSession}
              />
            ))}
          {!chatList.collapsed && listedChats.length === 0 && (
            <p className="flex min-h-row-compact touch:min-h-row-regular items-center pl-2 text-ui-body text-ink-4">
              尚无对话
            </p>
          )}
        </section>
      </div>
      <EntryDialogs
        request={entryRequest}
        onClose={() => setEntryRequest(null)}
        onRemoved={purgeRemovedEntries}
      />
      <Dialog
        open={sectionProjectId !== null}
        onOpenChange={(open) => {
          if (!open) setSectionProjectId(null);
        }}
      >
        <DialogContent size="sm">
          <DialogTitle>新建项目分组</DialogTitle>
          <DialogDescription>将当前项目放入此分组。</DialogDescription>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              const name = sectionName.trim();
              if (sectionProjectId && name) {
                setProjectPreference(sectionProjectId, { section: name });
                setSectionProjectId(null);
              }
            }}
          >
            <Input
              aria-label="分组名称"
              className="my-4"
              value={sectionName}
              maxLength={80}
              onChange={(event) => setSectionName(event.target.value)}
              autoFocus
            />
            <DialogFooter className="mt-0">
              <Button onClick={() => setSectionProjectId(null)} variant="ghost">
                取消
              </Button>
              <Button type="submit" disabled={!sectionName.trim()}>
                创建
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
