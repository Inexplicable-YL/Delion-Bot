// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import type { WorkspaceEntry, WorkspaceState } from '../../../../src/modules/workspace/contract';

const { api, desktop } = vi.hoisted(() => {
  const handlers: Record<string, (input: never) => unknown> = {};
  const subscribe = () => () => {};
  const desktop = {
    bridge: {
      invoke: async (channel: string, input: never) =>
        channel.startsWith('remotes:') ? [] : handlers[channel.split(':')[1]!]?.(input),
      subscribe,
    },
  } as unknown as NonNullable<typeof window.delionBot>;
  window.delionBot = desktop;
  return { api: handlers, desktop };
});
import { useTreeState } from '../../../../src/app/renderer/navigation/store';
import { useWorkspaceStore } from '../../../../src/modules/workspace/view';

const mediaStub = () => ({
  matches: false,
  addEventListener: () => {},
  removeEventListener: () => {},
});

let container: HTMLDivElement;
let root: Root;
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
  delete window.delionBot;
  for (const name of Object.keys(api)) delete api[name];
  useWorkspaceStore.setState({ workspace, loaded: true, error: null });
  useTreeState.setState({ expanded: [], query: '', selected: null, pendingCreate: null });
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
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
      <QueryClientProvider client={new QueryClient()}>
        <WorkbenchExplorer
          activeDocKey={activeDocKey}
          activeTab={null}
          onAction={onAction}
          onCreated={onCreated}
          onOpenDocument={() => {}}
          onOpenToSide={() => {}}
          projectId={projectId}
        />
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
  expect(treeRow('本地项目')).toBeTruthy();
  expect(treeRow('远端项目')).toBeUndefined();
  expect(treeRow('外部项目')).toBeUndefined();
  expect(treeRow('外部资料')).toBeUndefined();
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
