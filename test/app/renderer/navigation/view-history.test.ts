// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { WorkspaceEntry, WorkspaceState } from '../../../../src/modules/workspace/contract';
import { useWorkspaceStore } from '../../../../src/modules/workspace/view';
import { useNavigationStore } from '../../../../src/app/renderer/navigation/view';
import { useMobileDrawer } from '../../../../src/app/renderer/shell/mobile-drawer';
import { usePreferences } from '../../../../src/app/renderer/shell/preferences';
import {
  saveWorkbenchLayout,
  useWorkbenchLayout,
} from '../../../../src/app/renderer/workbench/layout-store';
import {
  createDefaultLayout,
  walkGroups,
} from '../../../../src/app/renderer/workbench/layout-schema';

const project: WorkspaceEntry = {
  id: 'p1',
  parentId: null,
  name: 'ChangYo',
  kind: 'project',
  sourceId: null,
  path: 'D:/code/ChangYo',
  updatedAt: '2026-10-09T00:00:00.000Z',
};

const workspace: WorkspaceState = { entries: [project], directory: 'D:/code' };

function seed(view: 'home' | 'workbench' | 'settings', projectId: string | null): void {
  useNavigationStore.setState({ view, target: null, projectId, backStack: [], forwardStack: [] });
  localStorage.clear();
}

beforeEach(() => {
  useWorkspaceStore.setState({ workspace, loaded: true, error: null });
});

describe('打开回复引用的文件', () => {
  const path = 'D:/code/readme.md';
  const fileTab = `note:${path}`;
  const groups = () => walkGroups(useWorkbenchLayout.getState().root);

  beforeEach(() => {
    seed('home', null);
    useWorkbenchLayout.setState({
      ...createDefaultLayout(),
      projectId: null,
      ready: false,
      pendingReveal: null,
      explorerCollapsedForReply: false,
    });
    usePreferences.setState({ workspaceSidebarCollapsed: false });
  });
  afterEach(async () => {
    await saveWorkbenchLayout();
  });

  it('从首页进入时等待项目布局，再把会话和文件分到两组', async () => {
    useMobileDrawer.getState().setDrawer('explorer');
    expect(useNavigationStore.getState().openReplyFile(path, 'session', 'p1')).toBe(true);
    expect(useNavigationStore.getState()).toMatchObject({ view: 'workbench', projectId: 'p1' });
    expect(useMobileDrawer.getState().drawer).toBeNull();
    await useWorkbenchLayout.getState().init('p1');
    expect(groups().map((group) => group.active)).toEqual(['chat:session', fileTab]);
    expect(useWorkbenchLayout.getState().explorerCollapsedForReply).toBe(true);
    expect(usePreferences.getState().workspaceSidebarCollapsed).toBe(false);
    useNavigationStore.getState().goBack();
    expect(useWorkbenchLayout.getState().explorerCollapsedForReply).toBe(false);
  });

  it('重复从首页打开同一会话的引用时复用已有标签及分组', async () => {
    const navigation = useNavigationStore.getState();
    await useWorkbenchLayout.getState().init(null);
    navigation.openReplyFile(path, 'session', null);
    useWorkbenchLayout.getState().setMaximized(groups()[1]!.id);
    navigation.goBack();
    navigation.openReplyFile(path, 'session', null);
    expect(groups().map((group) => group.tabs)).toEqual([['chat:session'], [fileTab]]);
    expect(useWorkbenchLayout.getState().maximized).toBeNull();
  });

  it('工作台内仍在当前组打开文件并保留侧栏状态', async () => {
    seed('workbench', 'p1');
    await useWorkbenchLayout.getState().init('p1');
    useWorkbenchLayout.getState().openTab('chat:session');
    useNavigationStore.getState().openReplyFile(path, 'session', 'p1');
    expect(groups().map((group) => group.tabs)).toEqual([['chat:session', fileTab]]);
    expect(useWorkbenchLayout.getState().explorerCollapsedForReply).toBe(false);
  });

  it('opens HTML references in a preview tab even when a source tab already exists', async () => {
    seed('workbench', null);
    await useWorkbenchLayout.getState().init(null);
    const html = 'D:/code/report.HTML';
    useWorkbenchLayout.getState().openTab(`note:${html}`);

    expect(useNavigationStore.getState().openReplyFile(html, 'session', null)).toBe(true);
    expect(groups()[0]?.active).toBe(`preview:${html}`);
  });

  it('首页引用已用条目 ID 打开的文件时复用该标签', async () => {
    useWorkspaceStore.setState({
      workspace: {
        ...workspace,
        entries: [
          ...workspace.entries,
          {
            id: 'saved-file',
            kind: 'file',
            name: 'readme.md',
            parentId: null,
            sourceId: null,
            updatedAt: '',
            path: 'D:\\CODE\\readme.md',
          },
        ],
      },
    });
    await useWorkbenchLayout.getState().init(null);
    useWorkbenchLayout.getState().openTab('note:saved-file');
    useNavigationStore.getState().openReplyFile(path, 'session', null);
    expect(groups().map((group) => group.tabs)).toEqual([['note:saved-file', 'chat:session']]);
    expect(groups()[0]?.active).toBe('note:saved-file');
  });
});

describe('导航历史', () => {
  it('离开项目工作台后，后退回到同一项目', () => {
    seed('workbench', 'p1');
    useNavigationStore.getState().navigate('home');
    expect(useNavigationStore.getState()).toMatchObject({ view: 'home', projectId: null });

    useNavigationStore.getState().goBack();
    expect(useNavigationStore.getState()).toMatchObject({ view: 'workbench', projectId: 'p1' });
    expect(localStorage.getItem('delion.workspace.project')).toBe('p1');
  });

  it('同视图切换项目或资料时关闭抽屉并记录历史', () => {
    seed('workbench', 'p1');
    useMobileDrawer.getState().setDrawer('explorer');
    useNavigationStore.getState().openProject('');
    expect(useNavigationStore.getState()).toMatchObject({ view: 'workbench', projectId: null });
    expect(useMobileDrawer.getState().drawer).toBeNull();

    useMobileDrawer.getState().setDrawer('nav');
    useNavigationStore.getState().openProject('p1');
    expect(useNavigationStore.getState()).toMatchObject({ view: 'workbench', projectId: 'p1' });
    expect(useMobileDrawer.getState().drawer).toBeNull();

    useNavigationStore.getState().goBack();
    expect(useNavigationStore.getState()).toMatchObject({ view: 'workbench', projectId: null });
    useNavigationStore.getState().goBack();
    expect(useNavigationStore.getState()).toMatchObject({ view: 'workbench', projectId: 'p1' });
  });

  it('前进回到离开后的视图，项目随之恢复', () => {
    seed('workbench', 'p1');
    useNavigationStore.getState().navigate('settings');
    useNavigationStore.getState().goBack();
    useNavigationStore.getState().goForward();
    expect(useNavigationStore.getState()).toMatchObject({ view: 'settings', projectId: 'p1' });
  });

  it('后退回到模块页面时带回离开时的跳转参数', () => {
    seed('home', null);
    useNavigationStore.getState().navigate({ page: 'todo', todoId: 't1' });
    useNavigationStore.getState().navigate('settings');
    useNavigationStore.getState().goBack();
    expect(useNavigationStore.getState()).toMatchObject({
      view: 'todo',
      target: { page: 'todo', todoId: 't1' },
    });
  });

  it('当前项目已删除时换池不记历史', () => {
    seed('workbench', 'p1');
    useWorkspaceStore.setState({ workspace: { ...workspace, entries: [] }, loaded: true });
    useNavigationStore.getState().openProject('');
    expect(useNavigationStore.getState().backStack).toEqual([]);
    expect(useNavigationStore.getState().projectId).toBeNull();
  });
});
