import { useState } from 'react';
import {
  ArchiveBoxIcon as Archive,
  ArrowsRightLeftIcon,
  ArrowUpTrayIcon as Upload,
  ChevronDoubleLeftIcon as PanelLeftClose,
  ChevronDoubleUpIcon as ChevronsDownUp,
  DocumentArrowUpIcon as FileInput,
  DocumentPlusIcon as FilePlus2,
  FolderIcon,
  FolderPlusIcon as FolderPlus,
  GlobeAltIcon as Globe,
  PlusIcon as Plus,
} from '@heroicons/react/24/outline';
import type { TabId } from '../../module';
import { ProjectChanges } from '../../../modules/chat/view';
import { workspaceArchiveId, type WorkspaceEntry } from '../../../modules/workspace/contract';
import { parseRemoteNodeId } from '../../../modules/remotes/contract';
import { Button } from '../../../ui/Button';
import { CollapseChevron } from '../../../ui/Collapse';
import { PanelHeader } from '../../../ui/PanelHeader';
import { SegmentedControl } from '../../../ui/SegmentedControl';
import { SearchInput } from '../../../ui/SearchInput';
import { Resizer } from '../../../ui/Resizer';
import { Tooltip, TooltipContent, TooltipTrigger } from '../../../ui/Tooltip';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  useAfterMenuClose,
} from '../../../ui/DropdownMenu';
import { ProjectFileTree, type EntryAction } from '../navigation/ProjectFileTree';
import { useSessions } from '../../../modules/chat/view';
import { shareLibrary } from './share-library';
import { walkGroups } from './layout-schema';
import { useWorkbenchLayout } from './layout-store';
import type { ExplorerPending } from '../../../modules/workspace/view';
import { useRemoteActivity } from '../navigation/remote-activity';
import { RemoteConnectionTip } from '../navigation/RemoteConnectionTip';
import { useRemoteConnections } from '../navigation/remote-connections';
import { ancestorChainOf, useTreeState } from '../navigation/store';
import { useNavigationStore as useAppNavigation } from '../navigation/view';
import {
  archiveEntries,
  importDroppedFiles,
  importFromDialog,
  isDescendant,
  moveEntries,
  promoteEntry,
  runEntryWork,
} from '../workspace/entry-actions';
import { useEntryDialog } from '../workspace/entry-dialog-store';
import { usePreferenceWidth, usePreferences } from '../shell/preferences';
import { useMobileDrawer } from '../shell/mobile-drawer';
import { RemotePortsDialog } from '../workspace/RemotePortsDialog';
import { openTarget } from './open-target';
import { useExplorerState, useExplorerVisible } from './ExplorerState';
import { explorerWidth } from './explorer-width';
import { useViewportWidth } from '../../../ui/use-viewport-width';
import { cn } from '../../../ui/cn';
import { overlayFade } from '../../../ui/motion';
import { IconButton } from '../../../ui/IconButton';
import {
  draggedEntryIds,
  explorerDragType,
  localPathsOf,
  workspaceClient,
  useWorkspaceStore,
} from '../../../modules/workspace/view';
import { errorMessage } from '../../../core/protocol/contract';

const SIDEBAR_MIN_WIDTH = 160;
const SIDEBAR_MAX_WIDTH = 360;

export function currentContainerOf(activeKey: string | null, rootId: string | null): string | null {
  const byId = new Map(
    useWorkspaceStore.getState().workspace.entries.map((entry) => [entry.id, entry]),
  );
  const withinRoot = (id: string): boolean => {
    if (!rootId) return true;
    const seen = new Set<string>();
    for (
      let current = byId.get(id);
      current && !seen.has(current.id);
      current = current.parentId ? byId.get(current.parentId) : undefined
    ) {
      if (current.id === rootId) return true;
      seen.add(current.id);
    }
    return false;
  };
  const entry = activeKey ? byId.get(activeKey) : undefined;
  if (!entry) return rootId;
  const folder = entry.kind === 'folder' || entry.kind === 'project' ? entry.id : entry.parentId;
  return folder && withinRoot(folder) ? folder : rootId;
}

export function WorkbenchExplorer({
  projectId,
  activeDocKey,
  activeTab,
  onAction,
  onOpenDocument,
  onOpenToSide,
  onCreated,
}: {
  projectId: string | null;
  activeDocKey: string | null;
  activeTab: TabId | null;
  onAction: (action: EntryAction | 'link', id: string | null) => void;
  onOpenDocument: (key: string) => void;
  onOpenToSide: (key: string) => void;
  onCreated: (entry: WorkspaceEntry) => void;
}) {
  const entries = useWorkspaceStore((s) => s.workspace.entries);
  const storageDirectory = useWorkspaceStore((s) => s.workspace.directory);
  const libraryRoot = storageDirectory ? `${storageDirectory}/workspace` : undefined;
  const layoutRoot = useWorkbenchLayout((s) => s.root);
  const maximizedGroupId = useWorkbenchLayout((s) => s.maximized);
  const focusedGroupId = useWorkbenchLayout((s) => s.focus);
  const sessionTitles = useSessions((s) => s.lists.general);
  const share =
    projectId !== null
      ? null
      : storageDirectory
        ? shareLibrary({
            directory: storageDirectory,
            groups: walkGroups(layoutRoot),
            maximizedGroupId,
            focusedGroupId,
            titles: Object.fromEntries((sessionTitles ?? []).map((item) => [item.id, item.title])),
            loaded: entries,
          })
        : {
            mode: 'empty' as const,
            rootId: null,
            selectedId: null,
            expandedIds: [],
            entries: [],
            sectionTitle: null,
          };
  const rootId = entries.some((entry) => entry.id === projectId) ? projectId : null;
  const root = entries.find((e) => e.id === rootId);
  const remoteRoot = Boolean(root?.remoteId);
  const connections = useRemoteConnections();
  const activity = useRemoteActivity((s) => s.byProject);
  const selected = useTreeState((s) => s.selected);
  const folderReveal = useTreeState((s) => s.folderReveal);
  const expanded = useTreeState((s) => s.expanded);
  const query = useTreeState((s) => s.query);
  const pendingCreate = useTreeState((s) => s.pendingCreate);
  const { width, onChange } = usePreferenceWidth('workspaceSidebarWidth');
  const narrow = useExplorerState((s) => s.narrow);
  const visible = useExplorerVisible();
  const viewportWidth = useViewportWidth();
  const [mode, setMode] = useState<'files' | 'changes'>('files');
  const changesProjectId = root?.kind === 'project' && root.path && !remoteRoot ? root.id : null;
  const showChanges = changesProjectId !== null && mode === 'changes';
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [draggingEntry, setDraggingEntry] = useState(false);

  const drawerRef = (drawer: HTMLElement | null) => {
    if (!drawer || !narrow || !visible) return;
    drawer.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') useMobileDrawer.getState().setDrawer(null);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  };

  const expand = (id: string, open: boolean) => useTreeState.getState().expand(id, open);
  const container = () => {
    if (share?.mode === 'flat') return share.rootId;
    if (share?.mode === 'grouped') {
      const key = selected ?? activeDocKey ?? share.selectedId;
      const hit = share.entries.find((entry) => entry.id === key);
      if (hit?.kind === 'folder' || hit?.kind === 'project') return hit.id;
      if (hit?.parentId) return hit.parentId;
      return share.selectedId;
    }
    return currentContainerOf(selected ?? activeDocKey, rootId);
  };

  const selectEntry = (id: string) => {
    const item = useWorkspaceStore.getState().workspace.entries.find((entry) => entry.id === id);
    if (!item) {
      if (parseRemoteNodeId(id)) onOpenDocument(id);
      return;
    }
    if (item.kind === 'folder' || item.kind === 'project') {
      useTreeState.getState().select(id);
      expand(id, !expanded.includes(id));
    } else {
      if (folderReveal) useTreeState.getState().select(null);
      onOpenDocument(id);
    }
  };

  const openToSide = (key: string) => {
    const item = useWorkspaceStore.getState().workspace.entries.find((entry) => entry.id === key);
    if (item?.kind === 'folder' || item?.kind === 'project') selectEntry(key);
    else onOpenToSide(key);
  };

  const keepDocument = (key: string) =>
    void useAppNavigation.getState().openDocument(key, { keep: true });

  const openProject = (id: string) => void useAppNavigation.getState().openProject(id);

  const move = (dragIds: string[], targetId: string | null) =>
    moveEntries(dragIds, targetId, rootId, (target) => {
      if (target) expand(target, true);
    });
  const importDropped = (files: File[], targetId: string | null) =>
    importDroppedFiles(files, targetId, rootId, (target) => {
      if (target) expand(target, true);
    });
  const importDroppedAnywhere = (files: File[], targetId: string | null) => {
    const remote = targetId ? parseRemoteNodeId(targetId) : null;
    const projectId = remote?.projectId ?? (remoteRoot ? rootId : null);
    const directory = remote?.path ?? (remoteRoot ? root?.path : null);
    if (!projectId || !directory) return importDropped(files, targetId);
    if (targetId) expand(targetId, true);
    void runEntryWork(async () => {
      await workspaceClient.uploadRemoteFiles({ projectId, directory, paths: localPathsOf(files) });
    });
  };
  const [portsForProject, setPortsForProject] = useState<string | null>(null);
  const remoteAction = (action: 'download' | 'open' | 'upload', id: string) => {
    const remote = parseRemoteNodeId(id);
    if (!remote) return;
    void runEntryWork(async () => {
      if (action === 'download') await workspaceClient.downloadRemoteFile(remote);
      else if (action === 'open') await workspaceClient.openRemoteFile(remote);
      else
        await workspaceClient.uploadRemoteFiles({
          projectId: remote.projectId,
          directory: remote.path,
          paths: null,
        });
    });
  };
  const startCreate = (kind: 'file' | 'folder', parentId: string | null) => {
    const target = parentId ?? rootId;
    const chain = target ? ancestorChainOf(entries, target) : [];
    useTreeState.setState((s) => ({ expanded: [...new Set([...s.expanded, ...chain])] }));
    useTreeState.getState().startCreate({ kind, parentId: target });
  };
  const afterMenuClose = useAfterMenuClose();
  const pending: ExplorerPending | null = pendingCreate && {
    ...pendingCreate,
    onCancel: () => useTreeState.getState().cancelCreate(),
    onSubmit: async (name) => {
      try {
        const created = await workspaceClient.create({
          name,
          parentId: pendingCreate.parentId,
          kind: pendingCreate.kind,
        });
        useTreeState.getState().cancelCreate();
        await useWorkspaceStore.getState().refresh();
        onCreated(created);
        return null;
      } catch (cause) {
        return errorMessage(cause);
      }
    },
  };

  const treeAction = (action: EntryAction, id: string | null) => {
    if (action === 'note') startCreate('file', id);
    else if (action === 'folder') startCreate('folder', id);
    else if (action === 'import') importFromDialog(id);
    else if (action === 'archive' && id) archiveEntries([id], () => setArchiveOpen(true));
    else if (action === 'promote' && id)
      promoteEntry(id, (pid) => void useAppNavigation.getState().openProject(pid));
    else onAction(action, id);
  };
  const batchAction = (action: 'move' | 'archive' | 'remove', ids: string[]) => {
    if (action === 'archive') archiveEntries(ids, () => setArchiveOpen(true));
    else
      useEntryDialog.getState().open({
        action,
        id: null,
        ids,
        initialTarget:
          action === 'move'
            ? (currentContainerOf(selected ?? activeDocKey, rootId) ?? '')
            : undefined,
      });
  };

  const effectiveWidth = explorerWidth(width, viewportWidth);
  const wrapHeaderActions = !narrow && changesProjectId !== null && effectiveWidth < 220;
  const sectionClass = 'flex h-8 items-center gap-1 px-3 text-ui-subhead text-ink-2';
  const eyebrowClass = 'px-3 pt-3 pb-1 text-ui-subhead text-ink-2';

  return (
    <>
      {narrow && visible && !draggingEntry && (
        <div
          aria-hidden="true"
          className={cn(overlayFade, 'absolute inset-0 z-nav bg-scrim')}
          onMouseDown={() => useMobileDrawer.getState().setDrawer(null)}
        />
      )}
      <aside
        ref={drawerRef}
        aria-label="工作台目录"
        inert={!visible}
        tabIndex={-1}
        className={cn(
          'min-h-0 shrink-0 flex-col overflow-hidden bg-page',
          narrow &&
            'absolute inset-y-app-inset left-app-inset z-drawer w-sidebar max-w-sheet rounded-panel glass-thick animate-drawer-left',
          narrow && !visible ? 'hidden' : 'flex',
          !narrow && !visible && 'w-0',
        )}
        style={narrow || !visible ? undefined : { width: effectiveWidth }}
        onDragStart={(event) => {
          if (narrow && event.dataTransfer.types.includes(explorerDragType)) setDraggingEntry(true);
        }}
        onDragEnd={() => setDraggingEntry(false)}
      >
        <div
          className={cn(
            'flex min-h-0 flex-1 flex-col transition-opacity duration-base motion-reduce:transition-none',
            !narrow && !visible && 'pointer-events-none opacity-0',
          )}
          style={narrow ? undefined : { width: effectiveWidth }}
        >
          <PanelHeader className={cn(wrapHeaderActions && 'flex-wrap')} variant="plain">
            <IconButton
              aria-controls="workspace-explorer"
              aria-expanded={visible}
              aria-label={visible ? '收起目录' : '展开目录'}

              onClick={() => {
                if (narrow) useMobileDrawer.getState().setDrawer(null);
                else usePreferences.getState().setPreference('workspaceSidebarCollapsed', true);
              }}
              title={visible ? '收起目录' : '展开目录'}
            >
              <PanelLeftClose />
            </IconButton>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  className="min-w-0 truncate text-left text-ui-subhead font-semibold uppercase text-ink"
                  onClick={() => useTreeState.getState().select(rootId)}
                  title={
                    remoteRoot ? undefined : projectId ? (root?.name ?? '项目与文件夹') : '资料'
                  }
                  type="button"
                >
                  {projectId ? (root?.name ?? '项目与文件夹') : '资料'}
                </button>
              </TooltipTrigger>
              {remoteRoot && root && (
                <TooltipContent className="px-2.5 py-2" side="bottom">
                  <RemoteConnectionTip
                    activity={activity[root.id]}
                    connection={connections[root.remoteId!]}
                    project={root}
                  />
                </TooltipContent>
              )}
            </Tooltip>
            {changesProjectId && (
              <SegmentedControl
                aria-label="项目侧栏内容"
                className="ml-2.5 shrink-0"
                compact
                icons={{ files: FolderIcon, changes: ArrowsRightLeftIcon }}
                labels={{ files: '文件', changes: '修改' }}
                onChange={setMode}
                options={['files', 'changes']}
                value={mode}
              />
            )}
            <div
              className={cn(
                'ml-auto shrink-0 items-center gap-0.5',
                showChanges ? 'hidden' : 'flex',
                wrapHeaderActions && 'basis-full justify-end pb-1',
              )}
            >
              {remoteRoot && rootId && (
                <>
                  <Button
                    aria-label="预览远端端口"
                    className="hover:bg-hover-strong"
                    onClick={() => setPortsForProject(rootId)}
                    size="icon-xs"
                    title="预览远端端口"
                    variant="ghost"
                  >
                    <Globe />
                  </Button>
                  <Button
                    aria-label="上传本地文件"
                    className="hover:bg-hover-strong"
                    onClick={() => {
                      const directory = root?.path;
                      if (!directory) return;
                      void runEntryWork(async () => {
                        await workspaceClient.uploadRemoteFiles({
                          projectId: rootId,
                          directory,
                          paths: null,
                        });
                      });
                    }}
                    size="icon-xs"
                    title="上传本地文件到项目根目录"
                    variant="ghost"
                  >
                    <Upload />
                  </Button>
                </>
              )}
              {!remoteRoot && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      aria-label="新建"
                      className="hover:bg-hover-strong"
                      size="icon-xs"
                      title="新建"
                      variant="ghost"
                    >
                      <Plus />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent
                    align="end"
                    onCloseAutoFocus={afterMenuClose.onCloseAutoFocus}
                  >
                    <DropdownMenuItem
                      onSelect={() => {
                        const parentId = container();
                        afterMenuClose.defer(() => startCreate('file', parentId));
                      }}
                    >
                      <FilePlus2 />
                      新建文件
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onSelect={() => {
                        const parentId = container();
                        afterMenuClose.defer(() => startCreate('folder', parentId));
                      }}
                    >
                      <FolderPlus />
                      新建文件夹
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => importFromDialog(container())}>
                      <FileInput />
                      导入本地文件
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
              <Button
                aria-label="全部收起"
                className="hover:bg-hover-strong"
                onClick={() => useTreeState.getState().collapseAll()}
                size="icon-xs"
                title="全部收起"
                variant="ghost"
              >
                <ChevronsDownUp />
              </Button>
            </div>
          </PanelHeader>
          <div className="flex min-h-0 min-w-0 flex-1 flex-col" id="workspace-explorer">
            {showChanges && visible && (
              <ProjectChanges
                activeTab={activeTab}
                onOpen={(tabId) => {
                  openTarget(tabId);
                  if (narrow) useMobileDrawer.getState().setDrawer(null);
                }}
                projectId={changesProjectId}
              />
            )}

            <div className="flex min-h-0 flex-1 flex-col" hidden={showChanges}>
              <SearchInput
                aria-label="筛选已同步内容"
                className="mx-2 mb-1"
                onChange={(e) => useTreeState.getState().setQuery(e.target.value)}
                placeholder="筛选已同步内容…"
                value={query}
              />
              <div
                className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden"
                onClick={(event) => {
                  if (event.target === event.currentTarget) useTreeState.getState().select(rootId);
                }}
                onDoubleClick={(event) => {
                  if (remoteRoot) return;
                  if (event.target === event.currentTarget) startCreate('file', container());
                }}
                onDragOver={(event) => {
                  if (event.dataTransfer.types.includes('Files')) {
                    event.preventDefault();
                    event.dataTransfer.dropEffect = 'copy';
                    return;
                  }
                  if (event.target !== event.currentTarget) return;
                  if (!event.dataTransfer.types.includes('application/x-delion-entry')) return;
                  event.preventDefault();
                  event.dataTransfer.dropEffect = 'move';
                }}
                onDrop={(event) => {
                  if (event.dataTransfer.types.includes('Files')) {
                    if (event.defaultPrevented) return;
                    event.preventDefault();
                    importDroppedAnywhere(Array.from(event.dataTransfer.files), null);
                    return;
                  }
                  if (event.target !== event.currentTarget) return;
                  event.preventDefault();
                  const drag = draggedEntryIds(event.dataTransfer);
                  if (drag.length) move(drag, null);
                }}
              >
                <div className={eyebrowClass}>
                  {share?.mode === 'flat' && share.sectionTitle
                    ? `文件 > ${share.sectionTitle}`
                    : '文件'}
                </div>
                {visible && (
                  <ProjectFileTree
                    canDrop={(dragId, targetId) => !isDescendant(entries, targetId, dragId)}
                    entries={share ? share.entries : entries}
                    expanded={share ? [...new Set([...expanded, ...share.expandedIds])] : expanded}
                    folderReveal={share ? null : projectId === null ? folderReveal : null}
                    pending={pending}
                    onAction={treeAction}
                    onBatchAction={batchAction}
                    onExpand={expand}
                    onImportFiles={share || rootId ? importDroppedAnywhere : undefined}
                    onMove={remoteRoot ? undefined : move}
                    onOpenProject={openProject}
                    onOpenToSide={openToSide}
                    onActivate={keepDocument}
                    libraryRoot={share ? undefined : projectId === null ? libraryRoot : undefined}
                    onRemoteAction={remoteAction}
                    onSelect={selectEntry}
                    query={query}
                    rootId={share ? share.rootId : rootId}
                    selected={
                      share
                        ? activeDocKey && share.entries.some((entry) => entry.id === activeDocKey)
                          ? activeDocKey
                          : share.selectedId
                        : (projectId === null && folderReveal?.id) || activeDocKey || selected
                    }
                  />
                )}
              </div>
              {!share && (
                <div className="shrink-0 border-t border-line">
                  <button
                    aria-expanded={archiveOpen || Boolean(query.trim())}
                    className={cn(
                      sectionClass,
                      'w-full transition-colors duration-base hover:text-ink-2',
                    )}
                    onClick={() => setArchiveOpen((value) => !value)}
                    type="button"
                  >
                    <CollapseChevron open={archiveOpen || Boolean(query.trim())} />
                    <Archive className="size-4" />
                    归档
                  </button>
                  {(archiveOpen || query.trim()) && (
                    <div className="max-h-56 overflow-y-auto pb-1">
                      {visible && (
                        <ProjectFileTree
                          archived
                          canDrop={(dragId, targetId) => !isDescendant(entries, targetId, dragId)}
                          entries={entries}
                          expanded={expanded}
                          onAction={treeAction}
                          onBatchAction={batchAction}
                          onExpand={expand}
                          onMove={move}
                          onOpenProject={openProject}
                          onOpenToSide={openToSide}
                          onSelect={selectEntry}
                          query={query}
                          rootId={workspaceArchiveId}
                          selected={activeDocKey ?? selected}
                        />
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </aside>
      <Resizer
        className={cn('bg-transparent', !visible && 'hidden')}
        label="调整目录宽度"
        max={SIDEBAR_MAX_WIDTH}
        min={SIDEBAR_MIN_WIDTH}
        onChange={onChange}

        value={width}
      />
      {portsForProject !== null && (
        <RemotePortsDialog
          onClose={() => setPortsForProject(null)}
          open
          projectId={portsForProject}
        />
      )}
    </>
  );
}
