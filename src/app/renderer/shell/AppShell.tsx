import { useEffect, useEffectEvent, useState, type ComponentType, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Bars3Icon as Menu,
  BellIcon as Bell,
  ChatBubbleLeftEllipsisIcon as MessageCirclePlus,
  CheckIcon as Check,
  ChevronDownIcon as ChevronDown,
  ChevronLeftIcon as ChevronLeft,
  ChevronRightIcon as ChevronRight,
  ClipboardDocumentCheckIcon as SquareCheckBig,
  CodeBracketIcon as CodeXml,
  Cog6ToothIcon as Settings,
  CommandLineIcon as SquareTerminal,
  FolderOpenIcon as FolderOpen,
  MagnifyingGlassIcon as Search,
  MinusIcon as Minus,
  Square2StackIcon as Restore,
  StopIcon as Maximize,
  XMarkIcon as X,
} from '@heroicons/react/24/outline';
import { Sheet, SheetContent, SheetTrigger } from '../../../ui/sheet';
import { useEditorSettings } from '../../../modules/preview/view';
import { usePreferences } from './preferences';
import { showToast, Toaster } from '../../../ui/toast';
import { DelionBotBrand } from '../../../modules/settings/view';
import { cn } from '../../../ui/cn';
import { useMediaQuery } from '../../../ui/use-media-query';
import type { NavTarget } from '../../module';
import { useNavigationStore, type AppView, type ShellView } from '../navigation/view';
import { NARROW_WINDOW_QUERY, type MobileDrawer } from './mobile-drawer';
import { useShortcuts } from './shortcuts';
import {
  ProjectSessionNav,
  type BusinessNavId,
  type NavSessionSummary,
} from '../navigation/ProjectSessionNav';
import { zoomLevels, type ZoomPreference } from '../../../modules/settings/contract';
import { acceleratorKeys, matchShortcut, shortcutGroups } from '../../../modules/settings/contract';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../../../ui/dropdown-menu';
import { navRow } from '../navigation/nav-styles';
import { NewChatIcon } from '../navigation/new-chat-icon';
import { ConnectedAppIcons } from '../../../modules/connectors/view';
import { UpdateBadge } from '../../../modules/update/view';
import { navEntries, useVisibleNavEntries } from '../navigation/entries';
import { pageHasDrawer } from '../../views';
import { IconButton } from '../../../ui/icon-button';
import { SidebarIcon } from '../../../ui/sidebar-icon';
import { Button } from '../../../ui/button';
import { WindowControlButton } from '../../../ui/window-control-button';
import { Kbd } from '../../../ui/kbd';
import { workspaceClient, useWorkspaceStore } from '../../../modules/workspace/view';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '../../../ui/dialog';
import { errorMessage } from '../../../core/protocol/contract';

const platform = window.delionBot?.platform === 'darwin' ? 'mac' : 'other';
const fileManagerName = window.delionBot?.platform === 'darwin' ? 'Finder' : '资源管理器';

function ShortcutSection({ children, title }: { children: ReactNode; title: string }) {
  return (
    <section aria-label={title}>
      <h3 className="text-ui-subhead text-ink-2">{title}</h3>
      <div className="mt-2">{children}</div>
    </section>
  );
}

function ShortcutRow({ hint, keys, label }: { hint?: string; keys?: string[]; label: string }) {
  return (
    <div className="flex h-9 items-center justify-between gap-8">
      <span className="min-w-0 truncate text-ui-body text-ink-2">{label}</span>
      {keys ? (
        <span className="flex shrink-0 items-center gap-1">
          {keys.map((key) => (
            <Kbd key={key}>{key}</Kbd>
          ))}
        </span>
      ) : (
        <span className="shrink-0 text-ui-body text-ink-2">{hint}</span>
      )}
    </div>
  );
}

function WindowControls() {
  const queryClient = useQueryClient();
  const windowState = useQuery({
    queryKey: ['window', 'state'],
    queryFn: () => window.delionBot!.window.getState(),
    enabled: Boolean(window.delionBot),
  });
  const maximized = windowState.data?.maximized ?? false;
  useEffect(
    () =>
      window.delionBot?.window.onStateChange((state) =>
        queryClient.setQueryData(['window', 'state'], state),
      ),
    [queryClient],
  );

  if (!window.delionBot || platform === 'mac') return null;

  return (
    <div className="desktop-no-drag flex h-full items-center gap-2">
      <WindowControlButton aria-label="最小化" onClick={() => window.delionBot?.window.minimize()}>
        <Minus className="size-4" />
      </WindowControlButton>
      <WindowControlButton
        aria-label={maximized ? '还原' : '最大化'}
        onClick={() => window.delionBot?.window.toggleMaximize()}
      >
        {maximized ? <Restore className="-scale-x-100" /> : <Maximize />}
      </WindowControlButton>
      <WindowControlButton aria-label="关闭" close onClick={() => window.delionBot?.window.close()}>
        <X className="size-4" />
      </WindowControlButton>
    </div>
  );
}

type AppShellProps = {
  view: AppView;
  onNavigate: (next: ShellView | NavTarget) => void;
  mobileDrawer?: MobileDrawer | null;
  onMobileDrawerChange?: (drawer: MobileDrawer | null) => void;
  onDrawerSlot: (element: HTMLElement | null) => void;
  onBack: () => void;
  onForward: () => void;
  canBack: boolean;
  canForward: boolean;
  zoom: ZoomPreference;
  onZoomChange: (zoom: ZoomPreference) => void;
  children: ReactNode;
  onImportFiles: () => void;
  onNewProject: () => void;
  onSearch: () => void;
  notificationCount: number;
  todoUnreadCount: number;
  sessionsByProject: Record<string, NavSessionSummary[]>;
  generalSessions: NavSessionSummary[];
  activeSessionId: string | null;
  projectId: string | null;
  onOpenProject: (id: string) => void;
  onOpenSession: (sessionId: string) => void;
  onDeleteSession?: (sessionId: string) => void;
  onNewGeneralChat: () => void;
  onOpenSources: () => void;
  activeTabIsChat: boolean;
  onNavigateBusiness: (id: BusinessNavId) => void;
};

export function AppShell({
  view,
  onNavigate,
  mobileDrawer,
  onMobileDrawerChange,
  onDrawerSlot,
  onBack,
  onForward,
  canBack,
  canForward,
  zoom,
  onZoomChange,
  children,
  onImportFiles,
  onNewProject,
  onSearch,
  notificationCount,
  todoUnreadCount,
  sessionsByProject,
  generalSessions,
  activeSessionId,
  projectId,
  onOpenProject,
  onOpenSession,
  onDeleteSession,
  onNewGeneralChat,
  onOpenSources,
  activeTabIsChat,
  onNavigateBusiness,
}: AppShellProps) {
  const bindings = useShortcuts((state) => state.bindings);
  const sidebarCollapsed = usePreferences((state) => state.shellSidebarCollapsed);
  const projectOpenTarget = usePreferences((state) => state.projectOpenTarget);
  const setPreference = usePreferences((state) => state.setPreference);
  const narrow = useMediaQuery(NARROW_WINDOW_QUERY);
  const drawer = mobileDrawer ?? null;
  const navDrawerOpen = drawer === 'nav' || drawer === 'page';
  const [helpOpen, setHelpOpen] = useState(false);
  const [scrolledView, setScrolledView] = useState<AppView | null>(null);
  // 远端项目的目录在远端：VS Code 是经 Remote-SSH 打开的，文案必须写明，否则会被当成开本地目录。
  const projectIsRemote = useWorkspaceStore(
    (state) => state.workspace.entries.find((item) => item.id === projectId)?.remoteId != null,
  );
  const effectiveOpenTarget: 'vscode' | 'explorer' = projectIsRemote ? 'vscode' : projectOpenTarget;
  const vscodeOpenLabel = projectIsRemote ? '在 VS Code 中打开（SSH）' : '在 VS Code 打开项目';

  const visibleEntries = useVisibleNavEntries();
  const sourcesActive = view === 'workbench' && projectId === null && !activeTabIsChat;

  const openProjectDirectory = (target: 'vscode' | 'explorer') => {
    if (view !== 'workbench' || !projectId || !window.delionBot) return;
    const effective: 'vscode' | 'explorer' = projectIsRemote ? 'vscode' : target;
    if (effective === target) setPreference('projectOpenTarget', target);
    void workspaceClient
      .openProjectDirectory({ id: projectId, target: effective })
      .catch((cause: unknown) => {
        showToast({
          variant: 'error',
          title: '打开项目目录失败',
          description: errorMessage(cause),
        });
      });
  };

  const navigate = (next: ShellView | NavTarget) => {
    onNavigate(next);
    if (narrow)
      onMobileDrawerChange?.(typeof next !== 'string' && pageHasDrawer(next.page) ? 'page' : null);
  };

  const stepZoom = (direction: 1 | -1 | 0) => {
    if (direction === 0) {
      onZoomChange(1);
      return;
    }
    const index = zoomLevels.indexOf(zoom);
    onZoomChange(zoomLevels[Math.max(0, Math.min(index + direction, zoomLevels.length - 1))]!);
  };

  const runShortcut = useEffectEvent((action: NonNullable<ReturnType<typeof matchShortcut>>) => {
    switch (action) {
      case 'new-project':
        onNewProject();
        break;
      case 'import-files':
        onImportFiles();
        break;
      case 'global-search':
        onSearch();
        break;
      case 'zoom-in':
        stepZoom(1);
        break;
      case 'zoom-out':
        stepZoom(-1);
        break;
      case 'zoom-reset':
        stepZoom(0);
        break;
      case 'toggle-word-wrap':
        useEditorSettings.getState().toggleWordWrap();
        break;
      case 'open-home':
        onNewGeneralChat();
        break;
      case 'open-connectors':
        navigate({ page: 'connectors' });
        break;
      case 'open-settings':
        navigate('settings');
        break;
      case 'open-shortcuts':
        setHelpOpen(true);
        break;
    }
  });
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.isComposing) return;
      const action = matchShortcut(useShortcuts.getState().bindings, event, 'global', platform);
      if (!action) return;
      event.preventDefault();
      runShortcut(action);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const sidebarToggle = (
    <IconButton
      aria-controls="main-nav"
      aria-expanded={narrow ? navDrawerOpen : !sidebarCollapsed}
      aria-label={narrow || sidebarCollapsed ? '展开侧边栏' : '收起侧边栏'}
      className="desktop-no-drag size-control-md"
      size={null}
      onClick={narrow ? undefined : () => setPreference('shellSidebarCollapsed', !sidebarCollapsed)}
      title={narrow || sidebarCollapsed ? '展开侧边栏' : '收起侧边栏'}
    >
      {narrow ? <Menu /> : <SidebarIcon />}
    </IconButton>
  );

  const newChatItem = {
    id: 'new-chat',
    label: '新建聊天',
    icon: NewChatIcon,
    action: onNewGeneralChat,
  };
  const settingsItem = {
    id: 'settings',
    label: '设置',
    icon: Settings,
    action: () => navigate('settings'),
  };
  const todoItem = {
    id: 'todo',
    label: '待办',
    icon: SquareCheckBig,
    action: () => navigate({ page: 'todo' }),
    count: todoUnreadCount,
  };
  const notificationsItem = {
    id: 'notifications',
    label: '通知',
    icon: Bell,
    action: () => navigate({ page: 'notifications' }),
    count: notificationCount,
  };
  const searchItem = { id: 'search', label: '全局搜索', icon: Search, action: onSearch };
  const businessItems = visibleEntries.map((item) => ({
    ...item,
    action: () => (item.id === 'sources' ? onOpenSources() : onNavigateBusiness(item.id)),
  }));

  const navItems = (
    items: Array<{
      id: string;
      label: string;
      icon: ComponentType<{ className?: string }>;
      action: () => void;
      count?: number;
    }>,
    placement: 'header' | 'rail' | 'tab',
  ) =>
    items.map(({ id, label, icon: Icon, action, count }) => (
      <IconButton
        key={id}
        aria-current={(id === 'sources' ? sourcesActive : view === id) ? 'page' : undefined}
        aria-label={count ? `${label}，${count} 条未读` : label}
        className={cn(
          'relative',
          placement === 'tab' && 'app-tab-button',
          placement === 'tab' && id === 'sources' && 'app-tab-sources',
        )}
        onClick={action}
        size={placement === 'rail' ? 'lg' : 'md'}
        title={label}
      >
        <Icon className={placement === 'tab' ? 'size-6' : 'size-5'} />
        {placement === 'tab' && <span className="text-ui-caption">{label}</span>}
        {!!count && <span aria-hidden className="nav-unread-dot" />}
      </IconButton>
    ));

  const connectorItem = businessItems.find((item) => item.id === 'connectors');
  const compactFooter = !narrow && sidebarCollapsed;
  const footerItems = compactFooter ? [connectorItem, settingsItem] : [settingsItem, connectorItem];
  const sidebarFooter = compactFooter ? (
    <div className="app-rail-footer">
      {navItems(
        footerItems.filter((item) => item !== undefined),
        'rail',
      )}
    </div>
  ) : (
    <div className="app-nav-footer flex shrink-0 items-center gap-1.5 pt-2">
      {footerItems.map((item) => {
        if (!item) return null;
        const { id, label, icon: Icon, action } = item;
        const showLabel = id === 'connectors';
        return (
          <Button
            key={id}
            aria-current={view === id ? 'page' : undefined}
            aria-label={showLabel ? undefined : label}
            className={
              showLabel
                ? 'h-control-md min-w-0 flex-1 justify-start gap-2.5 px-2'
                : 'size-control-md touch:min-w-control-lg'
            }
            onClick={id === 'connectors' ? () => navigate({ page: 'connectors' }) : action}
            size={null}
            title={label}
            variant="glass"
          >
            <Icon className="size-5" />
            {showLabel && (
              <>
                <span className="min-w-0 flex-1 truncate text-left">{label}</span>
                <ConnectedAppIcons />
              </>
            )}
          </Button>
        );
      })}
    </div>
  );
  const navToggle = narrow ? <SheetTrigger asChild>{sidebarToggle}</SheetTrigger> : sidebarToggle;

  return (
    <Sheet
      open={narrow && navDrawerOpen}
      onOpenChange={(open) =>
        onMobileDrawerChange?.(open ? (pageHasDrawer(view) ? 'page' : 'nav') : null)
      }
    >
      <div
        className="app-shell"
        data-density="product"
        data-sidebar={sidebarCollapsed ? 'collapsed' : 'expanded'}
      >
        <header className="app-toolbar" data-scrolled={scrolledView === view}>
          <div className="flex min-w-0 items-center gap-1">
            <div className={cn('flex justify-center', !narrow && 'w-sidebar-collapsed')}>
              {navToggle}
            </div>
            <IconButton
              aria-label="后退"
              className="[-webkit-app-region:no-drag] ml-0.5"
              disabled={!canBack}
              onClick={onBack}
              title="后退"
            >
              <ChevronLeft />
            </IconButton>
            <IconButton
              aria-label="前进"
              className="[-webkit-app-region:no-drag] ml-0.5"
              disabled={!canForward}
              onClick={onForward}
              title="前进"
            >
              <ChevronRight />
            </IconButton>
          </div>
          <div className="flex h-full shrink-0 items-center">
            <UpdateBadge onOpen={() => useNavigationStore.getState().openSettings('general')} />
            {narrow && (
              <IconButton
                aria-label="全局搜索"
                className="desktop-no-drag"
                onClick={onSearch}
                title="全局搜索"
              >
                <Search />
              </IconButton>
            )}
            {view === 'workbench' && projectId && window.delionBot && (
              <div className="[-webkit-app-region:no-drag] flex shrink-0 items-center gap-1 px-2">
                <div className="glass flex h-control-md items-center rounded-full px-0.5">
                  <button
                    aria-label={
                      effectiveOpenTarget === 'vscode'
                        ? vscodeOpenLabel
                        : `在 ${fileManagerName} 中打开项目`
                    }
                    className="grid size-control-sm place-items-center rounded-full text-ink-2 transition-colors duration-base hover:bg-hover hover:text-ink"
                    onClick={() => openProjectDirectory(effectiveOpenTarget)}
                    title={
                      effectiveOpenTarget === 'vscode'
                        ? vscodeOpenLabel
                        : `在 ${fileManagerName} 中打开项目`
                    }
                    type="button"
                  >
                    {effectiveOpenTarget === 'vscode' ? (
                      <CodeXml className="size-4" />
                    ) : (
                      <FolderOpen className="size-4" />
                    )}
                  </button>
                  <DropdownMenu modal={false}>
                    <DropdownMenuTrigger asChild>
                      <button
                        aria-label="选择项目打开方式"
                        className="grid size-control-xs place-items-center rounded-full text-ink-2 transition-colors duration-base hover:bg-hover hover:text-ink data-[state=open]:bg-selected"
                        title="选择项目打开方式"
                        type="button"
                      >
                        <ChevronDown className="size-4" />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      {!projectIsRemote && (
                        <DropdownMenuItem onSelect={() => openProjectDirectory('explorer')}>
                          <FolderOpen />
                          {fileManagerName}
                          {effectiveOpenTarget === 'explorer' && <Check className="ml-auto" />}
                        </DropdownMenuItem>
                      )}
                      <DropdownMenuItem onSelect={() => openProjectDirectory('vscode')}>
                        <CodeXml />
                        {projectIsRemote ? 'VS Code（SSH）' : 'VS Code'}
                        {effectiveOpenTarget === 'vscode' && <Check className="ml-auto" />}
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
                <IconButton
                  aria-label="打开项目终端"
                  onClick={() => projectId && useNavigationStore.getState().openTerminal(projectId)}
                  title="打开项目终端"
                >
                  <SquareTerminal />
                </IconButton>
              </div>
            )}
            {view === 'workbench' && projectId === null && window.delionBot && (
              <IconButton
                aria-label="新聊天"
                className="[-webkit-app-region:no-drag] mr-1"
                onClick={() => void useNavigationStore.getState().newChat(null)}
                title="新聊天"
              >
                <MessageCirclePlus />
              </IconButton>
            )}
            <WindowControls />
          </div>
        </header>
        <Dialog onOpenChange={setHelpOpen} open={helpOpen}>
          <DialogContent size="xl" className="p-8 max-md:p-6">
            <DialogHeader className="items-start gap-4">
              <div>
                <DialogTitle className="text-ui-title-2">快捷键</DialogTitle>
                <DialogDescription>
                  与设置 › 快捷键 同源；工作台类快捷键需焦点在工作区内。
                </DialogDescription>
              </div>
              <DialogClose className="-mr-1 -mt-1" />
            </DialogHeader>
            <div className="mt-8 grid items-start gap-x-12 gap-y-8 sm:grid-cols-2">
              {shortcutGroups().map((group) => (
                <ShortcutSection key={group.title} title={group.title}>
                  {group.actions.map((action) => {
                    const keys = bindings[action.id]
                      ? acceleratorKeys(bindings[action.id], platform, action.family)
                      : null;
                    return (
                      <ShortcutRow
                        hint={keys ? undefined : '未绑定'}
                        key={action.id}
                        keys={keys ?? undefined}
                        label={action.label}
                      />
                    );
                  })}
                </ShortcutSection>
              ))}
              <ShortcutSection title="鼠标">
                <ShortcutRow hint="关闭标签" label="中键点击标签" />
                <ShortcutRow hint="新建文件" label="双击目录空白处" />
              </ShortcutSection>
            </div>
          </DialogContent>
        </Dialog>
        {narrow && (
          <nav aria-label="快速导航" className="app-tab-bar glass">
            {navItems(
              [
                newChatItem,
                ...businessItems.filter((item) => item.id === 'sources'),
                todoItem,
                notificationsItem,
                settingsItem,
              ],
              'tab',
            )}
          </nav>
        )}
        <NavigationPanel
          narrow={narrow}
          collapsed={sidebarCollapsed}
          pageDrawer={drawer === 'page'}
          onBack={() => onMobileDrawerChange?.('nav')}
          onDrawerSlot={onDrawerSlot}
        >
          {!narrow && sidebarCollapsed ? (
            <nav aria-label="快捷入口" className="app-rail">
              <div className="grid h-toolbar place-items-center">
                <DelionBotBrand className="size-6" />
              </div>
              <div className="app-rail-primary">
                {navItems(
                  [
                    newChatItem,
                    ...businessItems.filter((item) => item.id !== 'connectors'),
                    todoItem,
                    notificationsItem,
                    searchItem,
                  ],
                  'rail',
                )}
              </div>
              {sidebarFooter}
            </nav>
          ) : (
            <>
              <div className="flex h-toolbar shrink-0 items-center gap-0.5 px-1">
                <div className="flex min-w-0 items-center gap-2 px-1">
                  <DelionBotBrand alt="" className="size-6 shrink-0" />
                  <span className="truncate text-ui-title-3">Delion Bot</span>
                </div>
                <div className="flex-1" />
                {navItems([todoItem, notificationsItem, searchItem], 'header')}
              </div>
              <ProjectSessionNav
                activeBusinessId={navEntries.find((entry) => entry.id === view)?.id ?? null}
                activeProjectId={view === 'workbench' ? projectId : null}
                activeSessionId={activeSessionId}
                generalSessions={generalSessions}
                onDeleteSession={onDeleteSession}
                onNewChat={(id) => void useNavigationStore.getState().newChat(id)}
                onNavigateBusiness={onNavigateBusiness}
                onNewProject={() => {
                  onNewProject();
                  if (narrow) onMobileDrawerChange?.(null);
                }}
                onNewGeneralChat={() => {
                  onNewGeneralChat();
                  if (narrow) onMobileDrawerChange?.(null);
                }}
                onOpenProject={onOpenProject}
                onOpenSession={onOpenSession}
                onOpenSources={onOpenSources}
                sessionsByProject={sessionsByProject}
                sourcesActive={sourcesActive}
              />
              {sidebarFooter}
            </>
          )}
        </NavigationPanel>
        <main
          className="app-content"
          id="app-main"
          onScrollCapture={(event) => {
            if (event.target instanceof HTMLElement)
              setScrolledView(event.target.scrollTop > 4 ? view : null);
          }}
        >
          {children}
        </main>
        <Toaster />
      </div>
    </Sheet>
  );
}

function NavigationPanel({
  narrow,
  collapsed,
  pageDrawer,
  onBack,
  onDrawerSlot,
  children,
}: {
  narrow: boolean;
  collapsed: boolean;
  pageDrawer: boolean;
  onBack: () => void;
  onDrawerSlot: (element: HTMLElement | null) => void;
  children: ReactNode;
}) {
  if (!narrow)
    return (
      <aside
        aria-label="主导航"
        className={cn('app-sidebar glass-thick', collapsed && 'items-center')}
        id="main-nav"
      >
        {children}
      </aside>
    );

  return (
    <SheetContent title={pageDrawer ? '分区导航' : '主导航'} id="main-nav">
      <div className={cn('min-h-0 flex-1 flex-col', pageDrawer ? 'hidden' : 'flex')}>
        {children}
      </div>
      <div className={cn('min-h-0 flex-1 flex-col', pageDrawer ? 'flex' : 'hidden')}>
        <button className={navRow(false)} onClick={onBack} type="button">
          <ChevronLeft className="size-4" />
          主菜单
        </button>
        <div className="flex min-h-0 flex-1 flex-col" ref={onDrawerSlot} />
      </div>
    </SheetContent>
  );
}
