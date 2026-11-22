import type { ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  type DocumentContent,
  type WorkspaceEntry,
  type TabId,
  decodeAssetPath,
  isRelativeAssetPath,
  noteAssetUrl,
  type ResourceRef,
} from '../../../modules/workspace/contract';
import { parseRemoteNodeId, remoteAssetUrl } from '../../../modules/remotes/contract';
import {
  ChatTabSourceProvider,
  type ChatTabSource,
  type ReferenceEntry,
  type ReferenceSource,
  useSessions,
  ChatHome,
  referenceEntryCandidates,
} from '../../../modules/chat/view';
import {
  NoteDraftSourceProvider,
  useNoteDrafts,
  type NoteDraftSource,
} from '../../../modules/note/view';
import {
  ContentLoaderProvider,
  parsePreviewTabId,
  type ContentLoader,
  type LoadedDocument,
} from '../../../modules/preview/view';
import { closeTabEverywhere, useWorkbenchLayout } from './layout-store';
import { useShortcuts } from '../shell/shortcuts';
import { walkGroups } from './layout-schema';
import { purgeRemovedEntries } from './removed-cleanup';
import { Workbench } from './Workbench';
import { EntryDialogs } from '../workspace/EntryDialogs';
import { useEntryDialog } from '../workspace/entry-dialog-store';
import { prefillNoteText, type EntryAction } from '../workspace/entry-actions';
import { ancestorChainOf, useTreeState } from '../navigation/store';
import { useLocalReferences, useRemoteReferences } from '../navigation/remote-references';
import { documentTabId, useNavigationStore } from '../navigation/view';
import { showToast } from '../../../ui/Toast';
import { currentContainerOf, WorkbenchExplorer } from './WorkbenchExplorer';
import { openTarget } from './open-target';
import { ErrorText } from '../../../ui/Alert';
import { officeRefOf, opensInApp, sourceOf, sourceOfLink } from '../../views';
import { workspaceClient, useWorkspaceStore } from '../../../modules/workspace/view';
import { errorMessage } from '../../../core/protocol/contract';

function tabDocumentKey(tabId: TabId | null): string | null {
  if (!tabId) return null;
  if (tabId.startsWith('preview:')) return tabId.slice('preview:'.length);
  if (tabId.startsWith('note:')) return tabId.slice('note:'.length);
  return null;
}

function newChatInCurrentPool() {
  void useNavigationStore.getState().newChat(useWorkbenchLayout.getState().projectId);
}

function useReferenceEntries(projectId: string | null, cwd: string | null) {
  const entries = useWorkspaceStore((state) => state.workspace.entries);
  const remote = entries.find((item) => item.id === projectId)?.remoteId;
  const remoteEntries = useRemoteReferences(remote ? projectId : null);
  const localFiles = useLocalReferences(remote ? null : cwd);
  const workspaceDirectory = useWorkspaceStore((state) => state.workspace.directory);
  const workspaceRoot =
    projectId === null && !remote && workspaceDirectory
      ? `${workspaceDirectory}${workspaceDirectory.includes('\\') ? '\\' : '/'}workspace`
      : null;
  const workspaceFiles = useLocalReferences(workspaceRoot);
  return referenceEntryCandidates(
    [
      ...new Map(
        [...entries, ...localFiles, ...workspaceFiles].map((item) => [item.id, item]),
      ).values(),
    ],
    cwd,
    projectId,
    remote,
    remoteEntries,
    workspaceRoot,
  );
}

function ReferenceEntries({
  projectId,
  cwd,
  children,
}: {
  projectId: string | null;
  cwd: string | null;
  children: (entries: ReferenceEntry[]) => ReactNode;
}) {
  return children(useReferenceEntries(projectId, cwd));
}

const referenceSource: ReferenceSource = {
  Entries: ReferenceEntries,
  flushReference: async (key) => {
    if (!(await useNoteDrafts.getState().save(key)))
      throw new Error('引用的笔记尚未保存成功，请先保存或移除该引用');
  },
};

const draftBase: Omit<NoteDraftSource, 'saveAsNewNote'> = {
  resolveImage: (entryId, src) => {
    if (!isRelativeAssetPath(src)) return src;
    const remote = parseRemoteNodeId(entryId);
    if (!remote) return noteAssetUrl(entryId, decodeAssetPath(src));
    const root =
      useWorkspaceStore.getState().workspace.entries.find((e) => e.id === remote.projectId)?.path ??
      '/';
    return remoteAssetUrl(remote.projectId, root, remote.path, src);
  },
  acquire: (key, force) => useNoteDrafts.getState().acquire(key, force),
  release: (key) => useNoteDrafts.getState().release(key),
  edit: (key, text) => {
    useWorkbenchLayout.getState().keepTab(`note:${key}`);
    useNoteDrafts.getState().edit(key, text);
  },
  save: (key) => useNoteDrafts.getState().save(key),
};

export function WorkbenchShell({ home }: { home?: boolean }) {
  const projectId = useNavigationStore((s) => (home ? null : s.projectId));
  const generalChat = useNavigationStore((s) => s.generalChat);
  const loaded = useWorkspaceStore((s) => s.loaded);
  const bindings = useShortcuts((s) => s.bindings);
  const workspaceError = useWorkspaceStore((s) => s.error);
  useWorkspaceStore((s) => s.workspace.entries);
  useSessions((s) => s.lists);
  const dialog = useEntryDialog((s) => s.request);
  const queryClient = useQueryClient();

  const activeTab = useWorkbenchLayout((s) => {
    const group = walkGroups(s.root).find((node) => node.id === s.focus);
    return group?.active ?? null;
  });
  const activeDocKey = tabDocumentKey(activeTab);
  const rootId = useWorkspaceStore((s) =>
    s.workspace.entries.some((entry) => entry.id === projectId) ? projectId : null,
  );

  const openDialog = (action: EntryAction | 'link', id: string | null, text?: string) =>
    useEntryDialog.getState().open({
      action,
      id,
      text,
      initialTarget:
        action === 'move' || action === 'link'
          ? (currentContainerOf(useTreeState.getState().selected ?? activeDocKey, rootId) ?? '')
          : undefined,
    });

  const onCreated = async (entry: WorkspaceEntry) => {
    if (entry.kind === 'project') return;
    if (window.delionBot && entry.path) {
      try {
        useWorkspaceStore
          .getState()
          .rememberEntries(await workspaceClient.localAncestors(entry.id));
      } catch (error) {
        useWorkspaceStore.getState().setError(error);
      }
    }
    if (entry.kind === 'file' || entry.kind === 'folder')
      useTreeState
        .getState()
        .reveal(ancestorChainOf(useWorkspaceStore.getState().workspace.entries, entry.id));
    if (entry.kind === 'file') useWorkbenchLayout.getState().openTab(documentTabId(entry.id));
    else if (entry.parentId) useTreeState.getState().expand(entry.parentId, true);
  };

  const onRemoved = (liveIds: Set<string>) => purgeRemovedEntries(liveIds);

  const initializeLayout = (element: HTMLDivElement | null) => {
    if (element && loaded) void useWorkbenchLayout.getState().init(projectId);
  };

  const chatSource: ChatTabSource = {
    referenceSource,
    navigate: (target) => useNavigationStore.getState().navigate(target),
    onCreateProject: () => useNavigationStore.getState().newProject(),
    workbench: {
      open: (tab, options) => openTarget(tab, options),
      openDocument: (key, options) =>
        options?.aside
          ? openTarget(documentTabId(key), { aside: true })
          : void useNavigationStore.getState().openDocument(key),
      close: closeTabEverywhere,
    },
    opensLink: opensInApp,
    onSaveNote: (text) =>
      openDialog(
        'note',
        currentContainerOf(useTreeState.getState().selected ?? activeDocKey, rootId),
        prefillNoteText(activeDocKey, text, queryClient),
      ),
  };

  const draftSource: NoteDraftSource = {
    ...draftBase,
    saveAsNewNote: (entryId, text) =>
      openDialog(
        'note',
        currentContainerOf(useTreeState.getState().selected ?? activeDocKey, rootId),
        prefillNoteText(entryId, text, queryClient),
      ),
  };

  const loader: ContentLoader = {
    loadDocument: async (tabKey: TabId): Promise<LoadedDocument> => {
      const target = parsePreviewTabId(tabKey);
      if (!target) throw new Error('无效的预览标签');
      if (!window.delionBot) throw new Error('文件预览仅在桌面端可用');
      const entries = useWorkspaceStore.getState().workspace.entries;
      let sourceId: string | null = null;
      let entry: WorkspaceEntry | undefined;
      let entryId: string | null = null;
      if ('sourceId' in target) sourceId = target.sourceId;
      else {
        entryId = target.entryId;
        const remote = parseRemoteNodeId(entryId);
        if (remote)
          return {
            content: await workspaceClient.readRemoteDocument(remote),
            watchesDisk: false,
          };
        entry = entries.find((e) => e.id === entryId);
        sourceId = entry?.sourceId ?? null;
      }
      const content: DocumentContent = sourceId
        ? await workspaceClient.readSource(sourceId)
        : await workspaceClient.read(entryId!);
      const document = sourceId ? sourceOf(sourceId)?.document : undefined;
      const officeRef: ResourceRef | undefined =
        content.format === 'pptx'
          ? sourceId && !document
            ? officeRefOf(sourceId)
            : entry?.kind === 'file'
              ? { type: 'workspace', id: entry.id }
              : undefined
          : undefined;
      return {
        content,
        source: sourceId && document ? { id: sourceId, document } : undefined,
        officeRef,
        watchesDisk: entry?.kind === 'file',
      };
    },
    openLink: (url) => {
      const sourceId = sourceOfLink(url, queryClient);
      if (sourceId) void useNavigationStore.getState().openDocument(`source:${sourceId}`);
      else window.open(url);
    },
    navigate: (target) => useNavigationStore.getState().navigate(target),
    onExported: () => {
      void useWorkspaceStore
        .getState()
        .refresh()
        .catch((cause) =>
          showToast({
            variant: 'error',
            title: '刷新目录失败',
            description: errorMessage(cause),
          }),
        );
    },
  };

  if (!home && !loaded && workspaceError === null && window.delionBot)
    return <div className="min-h-0 flex-1 bg-surface" />;

  return (
    <ChatTabSourceProvider source={chatSource}>
      <NoteDraftSourceProvider source={draftSource}>
        <ContentLoaderProvider loader={loader}>
          <div className="flex min-h-0 min-w-0 flex-1 flex-col" ref={initializeLayout}>
            {workspaceError && (
              <ErrorText size="sm" className="px-4 py-2">
                {workspaceError}
              </ErrorText>
            )}
            <div className="relative flex min-h-0 flex-1">
              {home ? (
                <ChatHome request={generalChat} />
              ) : (
                <>
                  <WorkbenchExplorer
                    key={projectId}
                    activeDocKey={activeDocKey}
                    activeTab={activeTab}
                    onAction={openDialog}
                    onCreated={onCreated}
                    onOpenDocument={(key) => void useNavigationStore.getState().openDocument(key)}
                    onOpenToSide={(key) => openTarget(documentTabId(key), { aside: true })}
                    projectId={projectId}
                  />
                  <Workbench bindings={bindings} onNewChat={newChatInCurrentPool} />
                </>
              )}
            </div>
            <EntryDialogs
              onClose={() => useEntryDialog.getState().close()}
              onCreated={onCreated}
              onOpenProject={(id) => void useNavigationStore.getState().openProject(id)}
              onRemoved={onRemoved}
              request={dialog}
            />
          </div>
        </ContentLoaderProvider>
      </NoteDraftSourceProvider>
    </ChatTabSourceProvider>
  );
}
