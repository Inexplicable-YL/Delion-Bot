import { useEffect, useState } from 'react';
import { useQueries, useQuery } from '@tanstack/react-query';
import { AppShell } from './AppShell';
import { ErrorBoundary } from './ErrorBoundary';
import { OnboardingFlow, isSmokeTest, readOnboardingState } from '../../../modules/onboarding/view';
import { SettingsPage } from '../settings';
import { ReleaseNotesDialog, UpdatePrompt } from '../../../modules/update/view';
import { GlobalSearchDialog } from '../../../modules/search/view';
import type { ChatSessionSummary } from '../../../core/protocol/agent';
import type { SearchHit } from '../../../modules/search/contract';
import type { NavTarget, PageDrawer } from '../../module';
import { pageOf, views } from '../../views';
import type { NavSessionSummary } from '../navigation/ProjectSessionNav';
import { useSessions, updateSession, onAgentEvent } from '../../../modules/chat/view';
import { closeTabEverywhere, useWorkbenchLayout } from '../workbench/layout-store';
import { walkGroups } from '../workbench/layout-schema';
import { importFromDialog } from '../workspace/entry-actions';
import { useNoteDrafts } from '../../../modules/note/view';
import { useWorkspaceStore } from '../../../modules/workspace/view';
import { showToast } from '../../../ui/Toast';
import { useNavigationStore } from '../navigation/view';
import { useMobileDrawer } from './mobile-drawer';
import { useNotificationCounts } from '../../../modules/notifications/view';
import { useAppearance } from './theme';
import { WorkbenchShell } from '../workbench/WorkbenchShell';
import { errorMessage } from '../../../core/protocol/contract';

function useSessionNavData(): {
  sessionsByProject: Record<string, NavSessionSummary[]>;
  generalSessions: NavSessionSummary[];
} {
  const lists = useSessions((state) => state.lists);
  const entries = useWorkspaceStore((state) => state.workspace.entries);
  const projects = entries.filter((entry) => entry.kind === 'project');
  const projectIds = projects.map((project) => project.id);
  useQueries({
    queries: [null, ...projectIds].map((id) => ({
      queryKey: ['chat', 'session-list', id],
      queryFn: () =>
        useSessions
          .getState()
          .refresh(id)
          .then(() => null),
      staleTime: Infinity,
    })),
  });
  const toSummaries = (list: ChatSessionSummary[]): NavSessionSummary[] =>
    list.map((session) => ({
      id: session.id,
      title: session.title,
      updatedAt: session.updatedAt,
      createdAt: session.createdAt,
      pinned: session.pinned,
    }));
  const sessionsByProject: Record<string, NavSessionSummary[]> = {};
  for (const project of projects)
    sessionsByProject[project.id] = toSummaries(lists[project.id] ?? []);
  return { sessionsByProject, generalSessions: toSummaries(lists.general ?? []) };
}

function ModulePage({ target, drawer }: { target: NavTarget; drawer: PageDrawer | null }) {
  const Page = pageOf(target.page)!.component;
  const navigate = useNavigationStore((state) => state.navigate);
  return <Page drawer={drawer} navigate={navigate} target={target} />;
}

function prewarmAgentAfterPaint(element: HTMLDivElement | null) {
  const desktop = window.delionBot;
  if (!element || !desktop) return;
  let frame = requestAnimationFrame(() => {
    frame = requestAnimationFrame(() => {
      desktop.window.contentReady();
    });
  });
  return () => cancelAnimationFrame(frame);
}

export default function App() {
  const [searchOpen, setSearchOpen] = useState(false);
  const [drawerSlot, setDrawerSlot] = useState<HTMLElement | null>(null);
  const mobileDrawer = useMobileDrawer((state) => state.drawer);
  const setMobileDrawer = useMobileDrawer((state) => state.setDrawer);
  const onboarding = useQuery({
    queryKey: ['onboarding'],
    queryFn: readOnboardingState,
    enabled: !isSmokeTest,
  });
  const [wizardFinished, setWizardFinished] = useState(false);
  const appVisible = isSmokeTest || wizardFinished || onboarding.data?.completed === true;

  const view = useNavigationStore((state) => state.view);
  const projectId = useNavigationStore((state) => state.projectId);
  const canBack = useNavigationStore((state) => state.backStack.length > 0);
  const canForward = useNavigationStore((state) => state.forwardStack.length > 0);
  const target = useNavigationStore((state) => state.target);

  const { theme, zoom, fontSize, changeTheme, changeZoom, changeFontSize } = useAppearance();
  const notifications = useNotificationCounts();
  const { sessionsByProject, generalSessions } = useSessionNavData();
  const homeSessionId = useSessions((state) => state.homeSessionId);
  const workbenchSessionId = useWorkbenchLayout((state) => {
    const group = walkGroups(state.root).find((node) => node.id === state.focus);
    const active = group?.active;
    return active?.startsWith('chat:') ? active.slice('chat:'.length) : null;
  });
  const activeSessionId =
    view === 'home' ? homeSessionId : view === 'workbench' ? workbenchSessionId : null;
  const activeTabIsChat = useWorkbenchLayout((state) => {
    const group = walkGroups(state.root).find((node) => node.id === state.focus);
    return group?.active?.startsWith('chat:') ?? false;
  });

  useEffect(() => {
    return onAgentEvent('session-update', ({ sessionId, chat }) => {
      if (chat.running) return;
      const store = useWorkspaceStore.getState();
      void store.refresh().catch(console.error);
      for (const [id, draft] of Object.entries(useNoteDrafts.getState().drafts)) {
        if (draft.text === draft.saved)
          void useNoteDrafts.getState().acquire(id, true).catch(console.error);
      }
      const lists = useSessions.getState().lists;
      for (const [pool, list] of Object.entries(lists)) {
        if (list.some((session) => session.id === sessionId)) {
          void useSessions
            .getState()
            .refresh(pool === 'general' ? null : pool)
            .catch(() => {});
          break;
        }
      }
    });
  }, []);

  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (
        Object.values(useNoteDrafts.getState().drafts).some((draft) => draft.text !== draft.saved)
      )
        event.preventDefault();
    };
    window.addEventListener('beforeunload', beforeUnload);
    return () => window.removeEventListener('beforeunload', beforeUnload);
  }, []);

  useEffect(() => {
    return window.delionBot?.window.onTrayAction((action) => {
      const navigation = useNavigationStore.getState();
      if (action === 'new-chat') navigation.openGeneralChat(true);
      else if (action === 'new-project') navigation.newProject();
      else if (action === 'open-settings') navigation.navigate('settings');
    });
  }, []);

  const openSearch = () => {
    setMobileDrawer(null);
    setSearchOpen(true);
  };

  const importFiles = () => {
    importFromDialog(view === 'workbench' ? useNavigationStore.getState().projectId : null);
  };

  const openSources = () => {
    const navigation = useNavigationStore.getState();
    if (navigation.view !== 'workbench' || navigation.projectId !== null) {
      void navigation.openProject('');
      return;
    }
    setMobileDrawer(null);
    const layout = useWorkbenchLayout.getState();
    const docTab = walkGroups(layout.root)
      .flatMap((group) => group.tabs)
      .find((tab) => tab.startsWith('note:') || tab.startsWith('preview:'));
    if (docTab) layout.openTab(docTab);
  };

  const openSearchResult = (result: SearchHit) => {
    useNavigationStore.getState().navigate(result.target);
  };

  return (
    <>
      {appVisible && (
        <AppShell
          canBack={canBack}
          canForward={canForward}
          mobileDrawer={mobileDrawer}
          onBack={() => void useNavigationStore.getState().goBack()}
          onForward={() => void useNavigationStore.getState().goForward()}
          onMobileDrawerChange={setMobileDrawer}
          onDrawerSlot={setDrawerSlot}
          onNavigate={(next) => void useNavigationStore.getState().navigate(next)}
          onZoomChange={(next) =>
            void changeZoom(next).catch((cause) =>
              showToast({
                variant: 'error',
                title: '调整缩放失败',
                description: errorMessage(cause),
              }),
            )
          }
          view={view}
          zoom={zoom}
          projectId={projectId}
          onOpenProject={(id) => void useNavigationStore.getState().openProject(id)}
          onNewProject={() => void useNavigationStore.getState().newProject()}
          onImportFiles={importFiles}
          onSearch={openSearch}
          onOpenSources={openSources}
          activeTabIsChat={activeTabIsChat}
          notificationCount={notifications.count}
          todoUnreadCount={notifications.todoUnread}
          sessionsByProject={sessionsByProject}
          generalSessions={generalSessions}
          activeSessionId={activeSessionId}
          onDeleteSession={async (sessionId) => {
            await updateSession(sessionId, { archived: true });
            closeTabEverywhere(`chat:${sessionId}`);
          }}
          onOpenSession={(sessionId) => {
            const lists = useSessions.getState().lists;
            let owner: string | null = null;
            for (const [pool, list] of Object.entries(lists)) {
              if (list.some((session) => session.id === sessionId)) {
                owner = pool === 'general' ? null : pool;
                break;
              }
            }
            void useNavigationStore.getState().openChat(sessionId, owner);
          }}
          onNewGeneralChat={() => void useNavigationStore.getState().openGeneralChat(true)}
          onNavigateBusiness={(id) =>
            void useNavigationStore.getState().navigate({ page: id } as NavTarget)
          }
        >
          <div
            className="flex min-h-0 flex-1 animate-view-in flex-col motion-reduce:animate-none"
            key={view === 'home' || view === 'workbench' ? 'workspace' : view}
            ref={view !== 'home' || homeSessionId ? prewarmAgentAfterPaint : undefined}
          >
            <ErrorBoundary title="此视图遇到错误">
              {(view === 'workbench' || view === 'home') && (
                <WorkbenchShell home={view === 'home'} />
              )}
              {target && (
                <ModulePage
                  drawer={
                    mobileDrawer === 'page' && drawerSlot
                      ? { container: drawerSlot, close: () => setMobileDrawer(null) }
                      : null
                  }
                  target={target}
                />
              )}
              {view === 'settings' && (
                <SettingsPage
                  fontSize={fontSize}
                  onFontSizeChange={changeFontSize}
                  onThemeChange={changeTheme}
                  onZoomChange={changeZoom}
                  theme={theme}
                  zoom={zoom}
                />
              )}
            </ErrorBoundary>
          </div>
        </AppShell>
      )}
      {appVisible && (
        <GlobalSearchDialog
          open={searchOpen}
          onOpenChange={setSearchOpen}
          onSelect={openSearchResult}
        />
      )}
      {onboarding.data && !appVisible && (
        <OnboardingFlow views={views} onWizardDone={() => setWizardFinished(true)} />
      )}

      {appVisible && <UpdatePrompt />}
      {appVisible && !isSmokeTest && <ReleaseNotesDialog />}
    </>
  );
}
