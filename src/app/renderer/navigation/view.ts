import { create } from 'zustand';
import {
  agentClient,
  type HomeChatRequest,
  updateSession,
  useSessions,
} from '../../../modules/chat/view';
import { previewable, useWorkbenchLayout } from '../workbench/layout-store';
import { openTarget } from '../workbench/open-target';
import { walkGroups } from '../workbench/layout-schema';
import { useEntryDialog } from '../workspace/entry-dialog-store';
import { useMobileDrawer } from '../shell/mobile-drawer';
import type { SettingsSectionId } from '../../../modules/settings/contract';
import type { TabId } from '../../../modules/workspace/contract';
import { useWorkspaceStore } from '../../../modules/workspace/view';
import { formatByName, isHtmlFile, opensInEditor } from '../../../core/protocol/files';
import { parseRemoteNodeId } from '../../../modules/remotes/contract';
import { showToast } from '../../../ui/Toast';
import type { NavTarget, NavTargets } from '../../module';
import { pageOf, views } from '../../views';
import { errorMessage } from '../../../core/protocol/contract';
import { updateEntry } from '../workspace/entry-actions';
import { archivedDocumentOf } from '../workspace/library-entries';

export type ShellView = 'home' | 'workbench' | 'settings';

type ShellTarget = 'projects' | 'chat' | 'sources' | 'settings';

export type AppView = ShellView | Exclude<keyof NavTargets, ShellTarget>;

const projectStorageKey = 'delion.workspace.project';

type RestoreRequest = {
  kind: 'document' | 'chat';
  title: string;
  restore: () => Promise<() => void>;
};

interface NavigationState {
  view: AppView;
  target: NavTarget | null;
  projectId: string | null;
  backStack: NavigationRoute[];
  forwardStack: NavigationRoute[];
  settingsSection: SettingsSectionId;
  generalChat: HomeChatRequest | null;
  homeSeq: number;
  restoreRequest: RestoreRequest | null;
  requestDocumentRestore(key: string, open: (id: string) => void): boolean;
  requestChatRestore(
    sessionId: string,
    projectId: string | null,
    title: string,
    open?: () => void,
  ): void;
  navigate(next: ShellView | NavTarget): boolean;
  goBack(): boolean;
  goForward(): boolean;
  openProject(id: string): boolean;
  openGeneralChat(create: boolean): boolean;
  newChat(projectId: string | null): Promise<string | null>;
  openChat(sessionId: string, projectId: string | null): boolean;
  openChatTab(sessionId: string, projectId: string | null): boolean;
  openDocument(key: string, options?: { keep?: boolean }): boolean;
  openReplyFile(key: string, sessionId: string, projectId: string | null): boolean;
  openTerminal(projectId: string): boolean;
  openSettings(section?: SettingsSectionId): boolean;
  newProject(): boolean;
}

interface NavigationRoute {
  view: AppView;
  target: NavTarget | null;
  projectId: string | null;
}

const leaveViews = (proceed: () => void) =>
  views.every((view) => view.leaveGuard?.(proceed) ?? true);

function routeOf(state: NavigationState): NavigationRoute {
  return { view: state.view, target: state.target, projectId: state.projectId };
}

function rememberProject(id: string | null): void {
  try {
    localStorage.setItem(projectStorageKey, id ?? '');
  } catch {}
}

function currentProjectLive(): boolean {
  const { projectId } = useNavigationStore.getState();
  return (
    projectId === null ||
    useWorkspaceStore.getState().workspace.entries.some((entry) => entry.id === projectId)
  );
}

export function documentTabId(key: string): TabId {
  if (key.startsWith('source:')) return `preview:${key}`;
  const remote = parseRemoteNodeId(key);
  if (remote) return formatByName(remote.path) === 'markdown' ? `note:${key}` : `preview:${key}`;
  const entry = useWorkspaceStore.getState().workspace.entries.find((e) => e.id === key);
  return (entry?.kind === 'file' || (!entry && /^(?:[a-z]:[\\/]|\/)/i.test(key))) &&
    opensInEditor(entry?.name ?? key)
    ? `note:${key}`
    : `preview:${key}`;
}

function openExistingReplyFile(key: string): boolean {
  const layout = useWorkbenchLayout.getState();
  if (!layout.ready) return false;
  const { entries } = useWorkspaceStore.getState().workspace;
  const fileIdentity = (key: string) => {
    const path = entries.find((entry) => entry.id === key)?.path ?? key;
    return /^(?:[a-z]:[\\/]|\\\\)/i.test(path) ? path.replaceAll('\\', '/').toLowerCase() : path;
  };
  const identity = fileIdentity(key);
  const existing = walkGroups(layout.root)
    .flatMap((group) => group.tabs)
    .find(
      (tab) =>
        previewable(tab) &&
        (!isHtmlFile(identity) || tab.startsWith('preview:')) &&
        fileIdentity(tab.slice(tab.indexOf(':') + 1)) === identity,
    );
  if (!existing) return false;
  layout.openTab(existing);
  if (layout.maximized && useWorkbenchLayout.getState().focus !== layout.maximized)
    layout.setMaximized(null);
  return true;
}

export const useNavigationStore = create<NavigationState>((set, get) => {
  const revealInProject = (
    tabId: TabId,
    projectId: string | null,
    keep = false,
    afterReveal?: () => void,
  ): boolean => {
    if (projectId !== get().projectId) {
      if (!get().openProject(projectId ?? '')) return false;
    } else if (!get().navigate('workbench')) return false;
    useWorkbenchLayout.getState().reveal(tabId, projectId, keep, afterReveal);
    return true;
  };
  return {
    view: 'home',
    target: null,
    projectId: null,
    backStack: [],
    forwardStack: [],
    settingsSection: 'general',
    generalChat: null,
    homeSeq: 0,
    restoreRequest: null,

    requestDocumentRestore: (key, open) => {
      const entry = archivedDocumentOf(useWorkspaceStore.getState().workspace, key);
      if (!entry) return false;
      set({
        restoreRequest: {
          kind: 'document',
          title: entry.name,
          restore: async () => {
            const { id } = await updateEntry(entry.id, { parentId: null });
            await useWorkspaceStore.getState().refresh();
            return () => open(id);
          },
        },
      });
      return true;
    },

    requestChatRestore: (sessionId, projectId, title, open) => {
      set({
        restoreRequest: {
          kind: 'chat',
          title: title || '新对话',
          restore: async () => {
            await updateSession(sessionId, { archived: false });
            return open ?? (() => void get().openChat(sessionId, projectId));
          },
        },
      });
    },

    navigate: (next) => {
      if (typeof next !== 'string') {
        if (next.page === 'projects') return get().openProject(next.entryId);
        if (next.page === 'chat') {
          if (next.sessionId) return get().openChat(next.sessionId, next.projectId);
          if (next.projectId === null && get().view === 'home') return get().openGeneralChat(true);
          void get().newChat(next.projectId);
          return true;
        }
        if (next.page === 'sources') return get().openDocument(`source:${next.sourceId}`);
        if (next.page === 'settings') return get().openSettings(next.section);
      }
      const view = typeof next === 'string' ? next : next.page;
      const target = typeof next === 'string' ? null : next;
      const page = target && pageOf(target.page);
      if (target && !page) {
        showToast({ variant: 'error', title: '该功能在当前版本中未启用' });
        return false;
      }
      const state = get();
      if (!leaveViews(() => get().navigate(next))) return false;
      if (view === state.view) {
        if (target) set({ target });
      } else {
        useMobileDrawer.getState().setDrawer(null);
        useWorkbenchLayout.setState({ explorerCollapsedForReply: false });
        set({
          view,
          target,
          ...(view === 'home' ? { projectId: null } : {}),
          backStack: [...state.backStack, routeOf(state)],
          forwardStack: [],
          settingsSection: 'general',
          generalChat: null,
        });
      }
      if (target) page?.open?.(target);
      return true;
    },

    goBack: () => {
      const state = get();
      const prev = state.backStack[state.backStack.length - 1];
      if (prev === undefined || !leaveViews(() => get().goBack())) return false;
      rememberProject(prev.projectId);
      useMobileDrawer.getState().setDrawer(null);
      useWorkbenchLayout.setState({ explorerCollapsedForReply: false });
      set({
        view: prev.view,
        target: prev.target,
        projectId: prev.projectId,
        backStack: state.backStack.slice(0, -1),
        forwardStack: [routeOf(state), ...state.forwardStack],
        settingsSection: 'general',
        generalChat: null,
      });
      return true;
    },

    goForward: () => {
      const state = get();
      const next = state.forwardStack[0];
      if (next === undefined || !leaveViews(() => get().goForward())) return false;
      rememberProject(next.projectId);
      useMobileDrawer.getState().setDrawer(null);
      useWorkbenchLayout.setState({ explorerCollapsedForReply: false });
      set({
        view: next.view,
        target: next.target,
        projectId: next.projectId,
        backStack: [...state.backStack, routeOf(state)],
        forwardStack: state.forwardStack.slice(1),
        settingsSection: 'general',
        generalChat: null,
      });
      return true;
    },

    openProject: (id) => {
      if (get().requestDocumentRestore(id, (restored) => get().openProject(restored))) return false;
      const next = id || null;
      const fromWorkbench = get().view === 'workbench';
      if (!get().navigate('workbench')) return false;
      useMobileDrawer.getState().setDrawer(null);
      if (get().projectId !== next) {
        useWorkbenchLayout.setState({ explorerCollapsedForReply: false });
        if (fromWorkbench && currentProjectLive()) {
          set((state) => ({ backStack: [...state.backStack, routeOf(state)], forwardStack: [] }));
        }
        set({ projectId: next });
      }
      rememberProject(id);
      set({ generalChat: null });
      return true;
    },

    openGeneralChat: (create) => {
      if (!get().navigate('home')) return false;
      const seq = get().homeSeq + 1;
      set({ projectId: null, homeSeq: seq, generalChat: { create, seq } });
      return true;
    },

    newChat: async (projectId) => {
      const onHome = projectId === null && get().view !== 'workbench';
      if (!window.delionBot || !get().navigate(onHome ? 'home' : 'workbench')) return null;
      try {
        const chat = await agentClient['create-session']({ projectId });
        if (!chat.sessionId) throw new Error('会话创建失败');
        useSessions.getState().putChat(chat.sessionId, chat);
        void useSessions
          .getState()
          .refresh(projectId)
          .catch(() => {});
        if (onHome) get().openChat(chat.sessionId, null);
        else revealInProject(`chat:${chat.sessionId}`, projectId);
        return chat.sessionId;
      } catch (cause) {
        showToast({ variant: 'error', title: '新建会话失败', description: errorMessage(cause) });
        return null;
      }
    },

    openChat: (sessionId, projectId) => {
      if (projectId === null && get().view === 'workbench' && get().projectId === null)
        return revealInProject(`chat:${sessionId}`, null);
      if (projectId !== null) return revealInProject(`chat:${sessionId}`, projectId);
      if (!get().navigate('home')) return false;
      const seq = get().homeSeq + 1;
      set({ projectId: null, homeSeq: seq, generalChat: { create: false, sessionId, seq } });
      return true;
    },

    openChatTab: (sessionId, projectId) => revealInProject(`chat:${sessionId}`, projectId),

    openDocument: (key, options) => {
      if (get().requestDocumentRestore(key, (id) => get().openDocument(id, options))) return false;
      return revealInProject(documentTabId(key), get().projectId, options?.keep);
    },

    openReplyFile: (key, sessionId, projectId) => {
      if (get().requestDocumentRestore(key, (id) => get().openReplyFile(id, sessionId, projectId)))
        return false;
      if (get().view === 'workbench')
        return openExistingReplyFile(key) || revealInProject(documentTabId(key), get().projectId);
      const opened = revealInProject(`chat:${sessionId}`, projectId, false, () => {
        const layout = useWorkbenchLayout.getState();
        if (layout.maximized) layout.setMaximized(null);
        if (!openExistingReplyFile(key)) openTarget(documentTabId(key), { aside: true });
      });
      if (opened) useWorkbenchLayout.setState({ explorerCollapsedForReply: true });
      return opened;
    },
    openTerminal: (projectId) => revealInProject(`terminal:${projectId}`, projectId),

    openSettings: (section) => {
      if (!get().navigate('settings')) return false;
      if (section) set({ settingsSection: section });
      return true;
    },

    newProject: () => {
      if (!get().navigate('workbench')) return false;
      useEntryDialog.getState().open({ action: 'project', id: null });
      return true;
    },
  };
});
