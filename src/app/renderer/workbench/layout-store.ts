import { create } from 'zustand';
import {
  type GroupNode,
  type LayoutNode,
  type SplitOrientation,
  type TabId,
  type WorkbenchLayout,
  relocateWorkspacePath,
} from '../../../modules/workspace/contract';
import {
  clampRatio,
  collapseEmptyGroups,
  countNodes,
  createDefaultLayout,
  findGroup,
  maxLayoutNodes,
  maxTabsPerGroup,
  nextGroupId,
  nodeAtPath,
  parseWorkbenchLayout,
  removeGroup,
  replaceAtPath,
  replaceGroupNode,
  updateGroup,
  walkGroups,
} from './layout-schema';
import type { EdgeZone } from './tab-dnd';
import { useWorkspaceStore, workspaceClient } from '../../../modules/workspace/view';
import { terminalClient } from '../../../modules/terminal/view';
import { showToast } from '../../../ui/Toast';
import { errorMessage } from '../../../core/protocol/contract';
import { archivedDocumentOf } from '../workspace/library-entries';

const PERSIST_DEBOUNCE_MS = 800;

const CAPACITY_LIMIT_REACHED = '工作组容量已达上限，已忽略本次操作';

function notifyCapacityLimit() {
  showToast({ variant: 'error', title: CAPACITY_LIMIT_REACHED });
}

export function previewable(tabId: TabId): boolean {
  return tabId.startsWith('note:') || tabId.startsWith('preview:');
}

type Store = {
  projectId: string | null;
  root: LayoutNode;
  focus: string;
  maximized: string | null;
  explorerAutoCollapsed: boolean;
  ready: boolean;
  pendingReveal: {
    tabId: TabId;
    projectId: string | null;
    keep: boolean;
    afterReveal?: () => void;
  } | null;
  init(projectId: string | null): Promise<void>;
  reveal(tabId: TabId, projectId: string | null, keep?: boolean, afterReveal?: () => void): void;
  openTab(
    tabId: TabId,
    targetGroupId?: string,
    options?: { preview?: boolean; index?: number },
  ): void;
  keepTab(tabId: TabId, groupId?: string): void;
  closeTab(tabId: TabId, groupId?: string): void;
  closeTabs(groupId: string, mode: 'others' | 'right' | 'all', anchor?: TabId): void;
  togglePin(tabId: TabId, groupId: string): void;
  moveTab(tabId: TabId, fromGroupId: string, toGroupId: string, targetIndex?: number): void;
  moveTabToEdge(tabId: TabId, fromGroupId: string, targetGroupId: string, zone: EdgeZone): void;
  splitGroup(groupId: string, orientation: SplitOrientation, emptyNew?: boolean): void;
  setMaximized(groupId: string | null): void;
  setRatio(path: number[], ratio: number): void;
  focusGroup(groupId: string): void;
  relocatePaths(from: string, to: string): void;
  persistTimer: ReturnType<typeof setTimeout> | null;
  pendingSaves: Promise<boolean>[];
  initToken: number;
};

function saveLayoutNow() {
  if (typeof window === 'undefined' || !window.delionBot) return Promise.resolve(false);
  const { projectId, root, focus, maximized } = useWorkbenchLayout.getState();
  const pending = workspaceClient
    .saveLayout({ projectId, layout: { root, focus, maximized } })
    .then(() => true)
    .catch(() => false);
  useWorkbenchLayout.setState((state) => ({ pendingSaves: [...state.pendingSaves, pending] }));
  void pending.then(() =>
    useWorkbenchLayout.setState((state) => ({
      pendingSaves: state.pendingSaves.filter((save) => save !== pending),
    })),
  );
  return pending;
}

export async function saveWorkbenchLayout(): Promise<boolean> {
  const { persistTimer } = useWorkbenchLayout.getState();
  if (persistTimer) clearTimeout(persistTimer);
  useWorkbenchLayout.setState({ persistTimer: null });
  const previous = await Promise.all(useWorkbenchLayout.getState().pendingSaves);
  if (previous.some((saved) => !saved)) return false;
  if (!useWorkbenchLayout.getState().ready) return true;
  return saveLayoutNow();
}

export function closeTabEverywhere(tabId: TabId): void {
  for (const group of walkGroups(useWorkbenchLayout.getState().root))
    if (group.tabs.includes(tabId)) useWorkbenchLayout.getState().closeTab(tabId, group.id);
}

function schedulePersist() {
  const { persistTimer } = useWorkbenchLayout.getState();
  if (persistTimer) clearTimeout(persistTimer);
  useWorkbenchLayout.setState({
    persistTimer: setTimeout(() => {
      useWorkbenchLayout.setState({ persistTimer: null });
      saveLayoutNow();
    }, PERSIST_DEBOUNCE_MS),
  });
}

function flushPersist() {
  const { persistTimer } = useWorkbenchLayout.getState();
  if (!persistTimer) return;
  clearTimeout(persistTimer);
  useWorkbenchLayout.setState({ persistTimer: null });
  saveLayoutNow();
}

export const useWorkbenchLayout = create<Store>((set, get) => ({
  projectId: null,
  root: createDefaultLayout().root,
  focus: 'primary',
  maximized: null,
  explorerAutoCollapsed: false,
  ready: false,
  pendingReveal: null,
  persistTimer: null,
  pendingSaves: [],
  initToken: 0,

  relocatePaths: (from, to) => {
    const remapTab = (tab: TabId): TabId => {
      if (!tab.startsWith('note:') && !tab.startsWith('preview:')) return tab;
      const colon = tab.indexOf(':');
      return `${tab.slice(0, colon)}:${relocateWorkspacePath(tab.slice(colon + 1), from, to)}` as TabId;
    };
    let root = get().root;
    for (const group of walkGroups(root))
      root = updateGroup(root, group.id, (current) => ({
        ...current,
        tabs: [...new Set(current.tabs.map(remapTab))],
        active: current.active ? remapTab(current.active) : null,
        ...(current.pinned ? { pinned: [...new Set(current.pinned.map(remapTab))] } : {}),
      }));
    set({ root });
    schedulePersist();
  },

  reveal: (tabId, projectId, keep = false, afterReveal) => {
    if (get().ready && get().projectId === projectId) {
      get().openTab(tabId, undefined, { preview: previewable(tabId) && projectId !== null });
      if (keep) get().keepTab(tabId);
      afterReveal?.();
      return;
    }
    set({ pendingReveal: { tabId, projectId, keep, afterReveal } });
  },

  init: async (projectId) => {
    if (get().ready && get().projectId === projectId) return;
    flushPersist();
    const token = get().initToken + 1;
    set({ initToken: token, ready: false });
    let saved: WorkbenchLayout | null = null;
    let loadFailed = false;
    if (typeof window !== 'undefined' && window.delionBot) {
      try {
        saved = await workspaceClient.layout(projectId);
      } catch (cause) {
        loadFailed = true;
        showToast({ variant: 'error', title: '布局载入失败', description: errorMessage(cause) });
      }
    }
    if (token !== get().initToken) return;
    const { workspace } = useWorkspaceStore.getState();
    const layout = parseWorkbenchLayout(
      saved,
      (tab) => !previewable(tab) || !archivedDocumentOf(workspace, tab.slice(tab.indexOf(':') + 1)),
    );
    const next = collapseEmptyGroups(layout ?? createDefaultLayout());
    set({ projectId, root: next.root, focus: next.focus, maximized: next.maximized, ready: true });
    const { pendingReveal } = get();
    if (pendingReveal) {
      set({ pendingReveal: null });
      if (pendingReveal.projectId === projectId)
        get().reveal(pendingReveal.tabId, projectId, pendingReveal.keep, pendingReveal.afterReveal);
    }
    if (!loadFailed) schedulePersist();
  },

  openTab: (tabId, targetGroupId, options) => {
    const { root, focus } = get();
    if (!targetGroupId) {
      const existing = walkGroups(root).find((group) => group.tabs.includes(tabId));
      if (existing) {
        if (existing.active !== tabId || focus !== existing.id) {
          set({
            root: updateGroup(root, existing.id, (group) => ({ ...group, active: tabId })),
            focus: existing.id,
          });
          schedulePersist();
        }
        return;
      }
    }
    const fallback = findGroup(root, focus) ?? walkGroups(root)[0];
    if (!fallback) return;
    const groupId = targetGroupId && findGroup(root, targetGroupId) ? targetGroupId : fallback.id;
    const group = findGroup(root, groupId)!;
    if (group.tabs.includes(tabId)) {
      set({
        root: updateGroup(root, groupId, (node) => ({ ...node, active: tabId })),
        focus: groupId,
      });
      schedulePersist();
      return;
    }
    const replaced = options?.preview ? group.preview : undefined;
    if (!replaced && group.tabs.length >= maxTabsPerGroup) {
      notifyCapacityLimit();
      return;
    }
    set({
      root: updateGroup(root, groupId, (node) => ({
        ...node,
        tabs: replaced
          ? node.tabs.map((tab) => (tab === replaced ? tabId : tab))
          : node.tabs.toSpliced(
              Math.max(node.pinned?.length ?? 0, options?.index ?? node.tabs.length),
              0,
              tabId,
            ),
        active: tabId,
        preview: options?.preview ? tabId : node.preview,
      })),
      focus: groupId,
    });
    schedulePersist();
  },

  keepTab: (tabId, groupId) => {
    const { root } = get();
    const group = groupId
      ? findGroup(root, groupId)
      : walkGroups(root).find((node) => node.preview === tabId);
    if (!group || group.preview !== tabId) return;
    set({ root: updateGroup(root, group.id, (node) => ({ ...node, preview: undefined })) });
    schedulePersist();
  },

  closeTab: (tabId, groupId) => {
    const { root, focus, maximized } = get();
    const group = findGroup(root, groupId ?? focus);
    if (!group || !group.tabs.includes(tabId)) return;
    const index = group.tabs.indexOf(tabId);
    const tabs = group.tabs.filter((tab) => tab !== tabId);
    const active = group.active === tabId ? (tabs[index] ?? tabs[index - 1] ?? null) : group.active;
    let nextRoot = updateGroup(root, group.id, (node) => {
      const pinned = node.pinned?.filter((tab) => tab !== tabId);
      return {
        ...node,
        tabs,
        active,
        pinned: pinned?.length ? pinned : undefined,
        preview: node.preview === tabId ? undefined : node.preview,
      };
    });
    let nextFocus = focus;
    let nextMaximized = maximized;
    if (!tabs.length && root.type === 'split') {
      const order = walkGroups(root).map((node) => node.id);
      const position = order.indexOf(group.id);
      const neighbor = order[position + 1] ?? order[position - 1] ?? null;
      nextRoot = removeGroup(nextRoot, group.id);
      nextFocus = neighbor ?? walkGroups(nextRoot)[0]!.id;
      if (nextMaximized === group.id) nextMaximized = null;
    }
    set({ root: nextRoot, focus: nextFocus, maximized: nextMaximized });
    if (
      tabId.startsWith('terminal:') &&
      !walkGroups(nextRoot).some((node) => node.tabs.includes(tabId))
    )
      void terminalClient.closeProject(tabId.slice('terminal:'.length)).catch((cause) => {
        console.error(cause);
        showToast({ variant: 'error', title: '关闭终端失败', description: errorMessage(cause) });
      });
    schedulePersist();
  },

  closeTabs: (groupId, mode, anchor) => {
    const group = findGroup(get().root, groupId);
    if (!group) return;
    const anchorTab = anchor ?? group.active;
    const index = anchorTab ? group.tabs.indexOf(anchorTab) : -1;
    const pinned = group.pinned ?? [];
    const notPinned = (tab: TabId) => !pinned.includes(tab);
    const victims =
      mode === 'all'
        ? group.tabs.filter(notPinned)
        : anchorTab && index >= 0
          ? mode === 'others'
            ? group.tabs.filter((tab) => tab !== anchorTab && notPinned(tab))
            : group.tabs.slice(index + 1).filter(notPinned)
          : [];
    for (const victim of victims) get().closeTab(victim, groupId);
  },

  togglePin: (tabId, groupId) => {
    const { root } = get();
    const group = findGroup(root, groupId);
    if (!group?.tabs.includes(tabId)) return;
    const pinned = group.pinned ?? [];
    const nextPinned = pinned.includes(tabId)
      ? pinned.filter((tab) => tab !== tabId)
      : [...pinned, tabId];
    const tabs = [...nextPinned, ...group.tabs.filter((tab) => !nextPinned.includes(tab))];
    set({
      root: updateGroup(root, groupId, (node) => ({
        ...node,
        tabs,
        pinned: nextPinned.length ? nextPinned : undefined,
        preview: node.preview === tabId ? undefined : node.preview,
      })),
    });
    schedulePersist();
  },

  moveTab: (tabId, fromGroupId, toGroupId, targetIndex) => {
    const { root } = get();
    const source = findGroup(root, fromGroupId);
    const destination = findGroup(root, toGroupId);
    if (!source || !destination || !source.tabs.includes(tabId)) return;
    const sameGroup = fromGroupId === toGroupId;
    const sourceTabs = source.tabs.filter((tab) => tab !== tabId);
    const destinationTabs = destination.tabs.filter((tab) => tab !== tabId);
    const pinnedCount = (destination.pinned ?? []).filter((tab) => tab !== tabId).length;
    const staysPinned = source.pinned?.includes(tabId) ?? false;
    const upper = staysPinned ? pinnedCount : destinationTabs.length;
    const index = Math.max(staysPinned ? 0 : pinnedCount, Math.min(targetIndex ?? upper, upper));
    destinationTabs.splice(index, 0, tabId);
    const pinnedSet = new Set(destination.pinned ?? []);
    if (staysPinned) pinnedSet.add(tabId);
    else pinnedSet.delete(tabId);
    const nextPinned = destinationTabs.filter((tab) => pinnedSet.has(tab));
    let nextRoot = updateGroup(root, fromGroupId, (group) => {
      const preview = group.preview === tabId ? undefined : group.preview;
      if (sameGroup)
        return {
          ...group,
          tabs: destinationTabs,
          active: group.active,
          pinned: nextPinned.length ? nextPinned : undefined,
          preview,
        };
      const pinned = group.pinned?.filter((tab) => tab !== tabId);
      return {
        ...group,
        tabs: sourceTabs,
        active: source.active === tabId ? (sourceTabs.at(-1) ?? null) : source.active,
        pinned: pinned?.length ? pinned : undefined,
        preview,
      };
    });
    if (!sameGroup)
      nextRoot = updateGroup(nextRoot, toGroupId, (group) => ({
        ...group,
        tabs: destinationTabs,
        active: tabId,
        pinned: nextPinned.length ? nextPinned : undefined,
        preview: group.preview === tabId ? undefined : group.preview,
      }));
    set(collapseEmptyGroups({ root: nextRoot, focus: toGroupId, maximized: get().maximized }));
    schedulePersist();
  },

  moveTabToEdge: (tabId, fromGroupId, targetGroupId, zone) => {
    const { root } = get();
    const target = findGroup(root, targetGroupId);
    if (!target || !findGroup(root, fromGroupId)?.tabs.includes(tabId)) return;
    if (fromGroupId === targetGroupId && target.tabs.length === 1) return;
    const orientation: SplitOrientation =
      zone === 'left' || zone === 'right' ? 'vertical' : 'horizontal';
    const newGroup: GroupNode = { type: 'group', id: nextGroupId(root), tabs: [], active: null };
    const children = zone === 'left' || zone === 'top' ? [newGroup, target] : [target, newGroup];
    const nextRoot = replaceGroupNode(root, targetGroupId, () => ({
      type: 'split',
      orientation,
      ratio: 0.5,
      children,
    }));
    if (countNodes(nextRoot) > maxLayoutNodes) {
      notifyCapacityLimit();
      return;
    }
    set({ root: nextRoot, maximized: null });
    get().moveTab(tabId, fromGroupId, newGroup.id);
  },

  splitGroup: (groupId, orientation, emptyNew = false) => {
    const { root } = get();
    const group = findGroup(root, groupId);
    if (!group?.active) return;
    const newGroup: GroupNode = {
      type: 'group',
      id: nextGroupId(root),
      tabs: emptyNew ? [] : [group.active],
      active: emptyNew ? null : group.active,
    };
    const nextRoot = replaceGroupNode(root, groupId, () => ({
      type: 'split',
      orientation,
      ratio: 0.5,
      children: [group, newGroup],
    }));
    if (countNodes(nextRoot) > maxLayoutNodes) {
      notifyCapacityLimit();
      return;
    }
    set({ root: nextRoot, focus: newGroup.id, maximized: null });
    schedulePersist();
  },

  setMaximized: (groupId) => {
    const { root } = get();
    if (groupId !== null && !findGroup(root, groupId)) return;
    set(groupId ? { maximized: groupId, focus: groupId } : { maximized: null });
    schedulePersist();
  },

  setRatio: (path, ratio) => {
    const { root } = get();
    const node = nodeAtPath(root, path);
    if (!node || node.type !== 'split') return;
    const next = clampRatio(ratio);
    if (next === node.ratio) return;
    set({ root: replaceAtPath(root, path, { ...node, ratio: next }) });
    schedulePersist();
  },

  focusGroup: (groupId) => {
    if (get().focus === groupId || !findGroup(get().root, groupId)) return;
    set({ focus: groupId });
    schedulePersist();
  },
}));
