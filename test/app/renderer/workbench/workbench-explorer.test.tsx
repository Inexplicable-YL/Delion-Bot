// @vitest-environment jsdom
import { focusManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { connectQueryEvents } from '../../../../src/app/renderer/shell/query-events';
import { chatContract } from '../../../../src/modules/chat/contract';
import {
  workspaceArchiveId,
  type GroupNode,
  type WorkspaceEntry,
  type WorkspaceState,
} from '../../../../src/modules/workspace/contract';

const { api, desktop, events } = vi.hoisted(() => {
  const handlers: Record<string, (input: never) => unknown> = {};
  const events = new Map<string, (payload: unknown) => void>();
  const desktop = {
    bridge: {
      invoke: async (channel: string, input: never) =>
        channel.startsWith('remotes:') ? [] : handlers[channel.split(':')[1]!]?.(input),
      subscribe(channel: string, listener: (payload: unknown) => void) {
        events.set(channel, listener);
        return () => events.delete(channel);
      },
    },
  } as unknown as NonNullable<typeof window.delionBot>;
  window.delionBot = desktop;
  return { api: handlers, desktop, events };
});
import { useTreeState } from '../../../../src/app/renderer/navigation/store';
import { useNavigationStore } from '../../../../src/app/renderer/navigation/view';
import { RestoreDialog } from '../../../../src/app/renderer/navigation/RestoreDialog';
import { useWorkspaceStore } from '../../../../src/modules/workspace/view';
import { createDefaultLayout } from '../../../../src/app/renderer/workbench/layout-schema';
import { useWorkbenchLayout } from '../../../../src/app/renderer/workbench/layout-store';

const mediaStub = () => ({
  matches: false,
  addEventListener: () => {},
  removeEventListener: () => {},
});

let container: HTMLDivElement;
let root: Root;
let queryClient: QueryClient;
let WorkbenchExplorer: typeof import('../../../../src/app/renderer/workbench/WorkbenchExplorer').WorkbenchExplorer;
let currentContainerOf: typeof import('../../../../src/app/renderer/workbench/WorkbenchExplorer').currentContainerOf;

beforeAll(async () => {
  vi.stubGlobal('matchMedia', mediaStub);
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  ({ WorkbenchExplorer, currentContainerOf } =
    await import('../../../../src/app/renderer/workbench/WorkbenchExplorer'));
});

const remoteProject: WorkspaceEntry = {
  id: 'p-remote',
  parentId: null,
  name: '远端项目',
  kind: 'project',
  sourceId: null,
  path: '/home/u/proj',
  remoteId: 'r-1',
  updatedAt: '2026-10-09T00:00:00.000Z',
};

const localProject: WorkspaceEntry = {
  id: '0197d5a2-7b1e-7cc2-9f3a-5e6d1c2b3a4d',
  parentId: null,
  name: '本地项目',
  kind: 'project',
  sourceId: null,
  path: 'D:/delion/workspace/本地项目',
  remoteId: null,
  updatedAt: '2026-10-09T00:00:00.000Z',
};

const localFolder: WorkspaceEntry = {
  id: 'f-local',
  parentId: localProject.id,
  name: '资料',
  kind: 'folder',
  sourceId: null,
  path: 'D:/delion/workspace/本地项目/资料',
  remoteId: null,
  updatedAt: '2026-10-09T00:00:00.000Z',
};

const workspace: WorkspaceState = {
  entries: [remoteProject, localProject],
  directory: 'D:/delion',
};

beforeEach(() => {
  vi.stubGlobal('matchMedia', mediaStub);
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  Element.prototype.scrollIntoView = () => {};
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  queryClient = new QueryClient();
  connectQueryEvents(queryClient, [chatContract], desktop.bridge);
  delete window.delionBot;
  for (const name of Object.keys(api)) delete api[name];
  useWorkspaceStore.setState({
    workspace,
    overview: null,
    directories: {},
    loaded: true,
    error: null,
  });
  useNavigationStore.setState({ view: 'home', projectId: null, restoreRequest: null });
  useWorkbenchLayout.setState({ ...createDefaultLayout(), projectId: null, ready: false });
  useTreeState.setState({
    expanded: [],
    query: '',
    selected: null,
    pendingCreate: null,
    folderReveal: null,
  });
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  events.clear();
  focusManager.setFocused(undefined);
  vi.useRealTimers();
});

const newButton = () => document.querySelector<HTMLElement>('[aria-label="新建"]');
const collapseButton = () => document.querySelector('[aria-label="全部收起"]');
const blank = () => document.querySelector<HTMLElement>('#workspace-explorer .overflow-y-auto')!;

const nameInput = () => document.querySelector<HTMLInputElement>('[aria-label="新文件名称"]');

async function render(projectId: string | null, activeDocKey: string | null = null) {
  const onAction = vi.fn();
  const onCreated = vi.fn();
  await act(async () =>
    root.render(
      <QueryClientProvider client={queryClient}>
        <WorkbenchExplorer
          activeDocKey={activeDocKey}
          activeTab={null}
          onAction={onAction}
          onCreated={onCreated}
          onOpenDocument={(key) => void useNavigationStore.getState().openDocument(key)}
          onOpenToSide={() => {}}
          projectId={projectId}
        />
        <RestoreDialog />
      </QueryClientProvider>,
    ),
  );
  return { onAction, onCreated };
}

it('hides the write entries while a remote project is open', async () => {
  const { onAction } = await render(remoteProject.id);
  expect(newButton()).toBeNull();
  expect(collapseButton()).toBeTruthy();

  await act(async () => blank().dispatchEvent(new MouseEvent('dblclick', { bubbles: true })));
  expect(onAction).not.toHaveBeenCalled();
  expect(nameInput()).toBeNull();
});

it('does not surface workspace folders in ordinary chat materials', async () => {
  useWorkspaceStore.setState({
    workspace: { ...workspace, entries: [...workspace.entries, localFolder] },
  });
  await render(null, 'active-document');
  await act(async () => useTreeState.getState().revealFolder([localProject.id, localFolder.id]));
  expect(container.querySelector('[aria-label="资料"]')).toBeNull();
  expect(container.querySelector('[aria-label="本地项目"]')).toBeNull();
});

function type(input: HTMLInputElement, value: string) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}
const key = (input: HTMLInputElement, name: string) =>
  input.dispatchEvent(new KeyboardEvent('keydown', { key: name, bubbles: true }));

it('creates files inline: double-click shows a name row, Enter submits, no dialog', async () => {
  const created: WorkspaceEntry = {
    ...localProject,
    id: 'D:/delion/workspace/本地项目/a/b.md',
    name: 'b.md',
    kind: 'file',
  };
  const create = vi.fn(async () => created);
  api.create = create;
  api.state = async () => workspace;
  window.delionBot = desktop;
  const { onAction, onCreated } = await render(localProject.id);
  expect(newButton()).toBeTruthy();

  await act(async () => blank().dispatchEvent(new MouseEvent('dblclick', { bubbles: true })));
  expect(onAction).not.toHaveBeenCalled();
  const input = nameInput()!;
  expect(document.activeElement).toBe(input);
  await act(async () => type(input, 'a/b.md'));
  await act(async () => key(input, 'Enter'));
  expect(create).toHaveBeenCalledWith({ name: 'a/b.md', parentId: localProject.id, kind: 'file' });
  expect(onCreated).toHaveBeenCalledWith(created);
  expect(nameInput()).toBeNull();
});

it('falls back to the current project root when the selection belongs to another project', () => {
  useWorkspaceStore.setState({
    workspace: { ...workspace, entries: [...workspace.entries, localFolder] },
    loaded: true,
    error: null,
  });
  expect(currentContainerOf(localFolder.id, remoteProject.id)).toBe(remoteProject.id);
  expect(currentContainerOf(localFolder.id, localProject.id)).toBe(localFolder.id);
  expect(currentContainerOf(null, localProject.id)).toBe(localProject.id);
  expect(currentContainerOf(localProject.id, null)).toBe(localProject.id);
});

const treeRow = (label: string) =>
  [...document.querySelectorAll('[role="treeitem"]')].find(
    (el) => el.getAttribute('aria-label') === label,
  );

it('asks before opening an archived file and opens its restored path after confirmation', async () => {
  const archivePath = 'D:/delion/workspace/归档';
  const archived: WorkspaceEntry = {
    id: `${archivePath}/归档笔记.md`,
    path: `${archivePath}/归档笔记.md`,
    name: '归档笔记.md',
    kind: 'file',
    parentId: workspaceArchiveId,
    sourceId: null,
    updatedAt: localProject.updatedAt,
  };
  const restoredPath = 'D:/delion/workspace/归档笔记.md';
  const restored: WorkspaceEntry = {
    ...archived,
    id: restoredPath,
    path: restoredPath,
    parentId: null,
  };
  const before: WorkspaceState = { ...workspace, archivePath };
  const update = vi.fn(() => ({ id: restored.id, fromPath: archived.path, toPath: restored.path }));
  api.listLocalDirectory = (id) =>
    id === workspaceArchiveId && !update.mock.calls.length ? [archived] : [];
  api.update = update;
  api.state = () => ({ ...before, entries: [...before.entries, restored] });
  window.delionBot = desktop;
  useWorkspaceStore.setState({ workspace: before, overview: before, directories: {} });
  useNavigationStore.setState({
    view: 'workbench',
    projectId: localProject.id,
    restoreRequest: null,
  });
  useWorkbenchLayout.setState({
    ...createDefaultLayout(),
    projectId: localProject.id,
    ready: true,
  });
  await render(localProject.id);

  const button = (text: string) =>
    [...document.querySelectorAll('button')].find(
      (element) => element.textContent?.trim() === text,
    )!;
  await act(async () => button('归档').click());
  await act(async () => (treeRow(archived.name) as HTMLElement).click());
  expect(document.querySelector('[role="alertdialog"]')).toBeTruthy();
  expect(useWorkbenchLayout.getState().root).toMatchObject({ tabs: [] });

  await act(async () => button('取消').click());
  expect(update).not.toHaveBeenCalled();
  await act(async () => (treeRow(archived.name) as HTMLElement).click());
  await act(async () => button('恢复并打开').click());

  expect(update).toHaveBeenCalledExactlyOnceWith({ id: archived.id, patch: { parentId: null } });
  expect(useWorkbenchLayout.getState().root).toMatchObject({ tabs: [`note:${restored.id}`] });
  expect(document.querySelector('[role="alertdialog"]')).toBeNull();
});

it('hides remote and external projects from the library tree', async () => {
  const externalProject: WorkspaceEntry = {
    ...localProject,
    id: 'p-external',
    name: '外部项目',
    path: 'D:/code/外部项目',
  };
  const externalFolder: WorkspaceEntry = {
    ...localFolder,
    id: 'f-external',
    name: '外部资料',
    parentId: externalProject.id,
    path: 'D:/code/外部项目/外部资料',
  };
  useWorkspaceStore.setState({
    workspace: { ...workspace, entries: [...workspace.entries, externalProject, externalFolder] },
    loaded: true,
    error: null,
  });
  useTreeState.setState({ expanded: [externalProject.id] });
  await render(null);
  expect(treeRow('本地项目')).toBeUndefined();
  expect(treeRow('远端项目')).toBeUndefined();
  expect(treeRow('外部项目')).toBeUndefined();
  expect(treeRow('外部资料')).toBeUndefined();
  expect(
    [...document.querySelectorAll('button')].some(
      (element) => element.textContent?.trim() === '归档',
    ),
  ).toBe(false);
});

it('switches the project sidebar and reuses the diff tab for the same file', async () => {
  const { useWorkbenchLayout } =
    await import('../../../../src/app/renderer/workbench/layout-store');
  const { walkGroups } = await import('../../../../src/app/renderer/workbench/layout-schema');
  window.delionBot = desktop;
  const read = vi.fn(async () => ({
    available: true,
    warnings: [],
    files: [{ path: 'src/app.ts', status: 'modified' }],
  }));
  api.readUncommittedChanges = read;
  await render(localProject.id);
  const toggle = (name: string) =>
    Array.from(
      container.querySelectorAll<HTMLButtonElement>('[aria-label="项目侧栏内容"] button'),
    ).find((button) => button.getAttribute('aria-label') === name)!;

  expect(read).not.toHaveBeenCalled();
  await act(async () => toggle('修改').click());
  await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
  expect(read).toHaveBeenCalledExactlyOnceWith(localProject.id);
  const fileFilter = () => container.querySelector('[aria-label="筛选已同步内容"]')!;
  expect(fileFilter().closest('[hidden]')).not.toBeNull();

  const file = container.querySelector<HTMLButtonElement>('button[title="src/app.ts"]')!;
  await act(async () => {
    file.click();
    file.click();
  });
  expect(walkGroups(useWorkbenchLayout.getState().root).flatMap((group) => group.tabs)).toEqual([
    `review:${localProject.id}:uncommitted:src/app.ts`,
  ]);

  await act(async () => toggle('文件').click());
  expect(fileFilter().closest('[hidden]')).toBeNull();
  expect(container.querySelector('[aria-label="筛选改动"]')).toBeNull();
});

it('keeps loading the pinned timeline when another file is selected and opens its Git version', async () => {
  vi.useFakeTimers({
    toFake: ['Date', 'setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'],
  });
  focusManager.setFocused(true);
  const sessionId = crypto.randomUUID();
  const folder = `D:/delion/chat-share/${sessionId}`;
  const files = ['first.txt', 'second.txt'].map((name) => ({
    ...localFolder,
    id: `${folder}/${name}`,
    path: `${folder}/${name}`,
    parentId: folder,
    name,
    kind: 'file' as const,
  }));
  const [first, second] = files;
  const eventId = 'a'.repeat(40);
  const initialEntry = {
    fromEventId: eventId,
    toEventId: eventId,
    at: new Date().toISOString(),
    status: 'modified',
    source: { kind: 'user' },
  };
  const savedEntries = [initialEntry];
  const loadTimeline = vi.fn(({ path }: { path: string }) => ({
    sessionId,
    path: `share/${path.slice(folder.length + 1)}`,
    entries: [...savedEntries],
  }));
  api.fileTimeline = loadTimeline;
  window.delionBot = desktop;
  useWorkspaceStore.setState({ workspace: { ...workspace, entries: files } });
  const group: GroupNode = {
    type: 'group',
    id: 'primary',
    tabs: [`chat:${sessionId}`],
    active: `chat:${sessionId}`,
  };
  useWorkbenchLayout.setState({ root: group, ready: true });

  const waitForRead = (path: string | null) =>
    act(async () => {
      await vi.waitFor(() => expect(loadTimeline).toHaveBeenLastCalledWith({ path }));
      await vi.advanceTimersByTimeAsync(1);
    });
  const button = (label: string) =>
    container.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`)!;
  await render(null, first!.id);
  await act(async () =>
    container
      .querySelector<HTMLButtonElement>(
        'button[aria-controls][aria-expanded="false"]:has(span[title])',
      )!
      .click(),
  );
  await waitForRead(first!.path);
  await act(async () => button('固定时间线').click());
  await render(null, second!.id);
  loadTimeline.mockClear();
  await act(async () => button('刷新时间线').click());
  await waitForRead(first!.path);

  const version = `review:${sessionId}:version:${eventId}:${eventId}:share/${first!.name}`;
  const { parseReviewTabId } = await import('../../../../src/modules/chat/view/review/tab-id');
  await act(async () =>
    container.querySelector<HTMLButtonElement>('ul[aria-label="文件时间线"] button')!.click(),
  );
  expect(useWorkbenchLayout.getState().root).toMatchObject({ active: version });
  expect(parseReviewTabId(version)).toMatchObject({ kind: 'version', toEventId: eventId });

  await act(async () => button('取消固定时间线').click());
  await waitForRead(second!.path);

  const timestamps = () => [...container.querySelectorAll('time')].map((time) => time.textContent);
  const initialTimestamps = timestamps();
  expect(initialTimestamps).toHaveLength(1);
  loadTimeline.mockClear();
  await act(async () => vi.advanceTimersByTimeAsync(20_000));
  expect(loadTimeline).not.toHaveBeenCalled();
  expect(timestamps()).toEqual(initialTimestamps);
  await act(async () => vi.advanceTimersByTimeAsync(10_001));
  expect(loadTimeline).toHaveBeenLastCalledWith({ path: second!.path });
  expect(timestamps()).not.toEqual(initialTimestamps);

  loadTimeline.mockClear();
  const newEventId = 'b'.repeat(40);
  savedEntries.unshift({
    ...initialEntry,
    fromEventId: newEventId,
    toEventId: newEventId,
    at: new Date().toISOString(),
  });
  await act(async () => {
    events.get('chat:fileTimeline')!(undefined);
    await vi.advanceTimersByTimeAsync(1);
  });
  expect(loadTimeline).toHaveBeenLastCalledWith({ path: second!.path });
  expect(timestamps()).toHaveLength(2);
});
