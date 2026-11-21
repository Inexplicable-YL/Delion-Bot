// @vitest-environment jsdom
import { act, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { DelionBotApi } from '../../../../src/app/preload/api';
import type { WorkspaceEntry, WorkspaceState } from '../../../../src/modules/workspace/contract';
import type {
  RemoteBrowseResult,
  RemoteConnection,
  RemoteSetupProgress,
} from '../../../../src/modules/remotes/contract';

const { workspaceApi, remotesApi, listeners, bridge } = vi.hoisted(() => {
  const handlers: Record<string, (input: never) => unknown> = {};
  const remotes: Record<string, (input: never) => unknown> = {};
  const listeners = new Map<string, (payload: unknown) => void>();
  const subscribe = (channel: string, listener: (payload: unknown) => void) => {
    listeners.set(channel, listener);
    return () => {};
  };
  const bridge = {
    invoke: async (channel: string, input: never) => {
      const [namespace, name] = channel.split(':');
      return (namespace === 'remotes' ? remotes : handlers)[name!]!(input);
    },
    subscribe,
  };
  window.delionBot = {
    bridge,
  } as unknown as DelionBotApi;
  return { workspaceApi: handlers, remotesApi: remotes, listeners, bridge };
});
import { NewRemoteProjectDialog } from '../../../../src/app/renderer/workspace/remote/NewRemoteProjectDialog';
import { usePreferences } from '../../../../src/app/renderer/shell/preferences';
import { useRemoteState } from '../../../../src/modules/remotes/view';
import { useWorkspaceStore } from '../../../../src/modules/workspace/view';

let container: HTMLDivElement;
let root: Root;
let queryClient: QueryClient;

const emptyState: WorkspaceState = { entries: [], directory: '/tmp/delion' };

const saved: RemoteConnection = {
  id: 'r-1',
  label: '实验室主机',
  host: 'gpu-box',
  port: 2222,
  keyPath: null,
  createdAt: '2026-10-09T00:00:00.000Z',
};

const created: WorkspaceEntry = {
  id: 'p-remote',
  parentId: null,
  name: '我的实验',
  kind: 'project',
  sourceId: null,
  path: '/home/u/proj',
  remoteId: 'r-1',
  updatedAt: '2026-10-09T00:00:00.000Z',
};

const listing = (path: string, names: string[]): RemoteBrowseResult => ({
  path,
  parent: path === '/' ? null : path.slice(0, path.lastIndexOf('/')) || '/',
  directories: names.map((name) => ({
    name,
    path: `${path === '/' ? '' : path}/${name}`,
    directory: true,
    size: null,
    modifiedAt: null,
  })),
});

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('matchMedia', () => ({
    matches: true,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  localStorage.clear();
  Element.prototype.scrollIntoView ??= () => {};
  useWorkspaceStore.setState({ workspace: emptyState, loaded: true, error: null });
  usePreferences.setState({ remoteLastDirectory: {} });
  useRemoteState.setState({ pushedChannels: null, homes: {}, setupLog: [] });
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  delete window.delionBot;
  vi.unstubAllGlobals();
});

function button(text: string): HTMLButtonElement {
  const element = [...document.querySelectorAll<HTMLButtonElement>('button')].find(
    (item) => item.textContent?.trim() === text,
  );
  if (!element) throw new Error(`Missing button: ${text}`);
  return element;
}

const input = (label: string) =>
  document.querySelector<HTMLInputElement>(`[aria-label="${label}"]`)!;

function setValue(target: HTMLInputElement, value: string) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(target, value);
  target.dispatchEvent(new Event('input', { bubbles: true }));
}

const Providers = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
);

const flush = () =>
  act(async () => {
    for (let tick = 0; tick < 3; tick++) await new Promise((resolve) => setTimeout(resolve, 0));
  });

function api(overrides: Record<string, unknown> = {}, workspace = {}) {
  const remotes = {
    list: vi.fn(async () => [saved]),
    configHosts: vi.fn(async () => []),
    helperStates: vi.fn(async () => []),
    prepare: vi.fn(async () => ({ ok: true, message: '', home: '/home/u' })),
    browse: vi.fn(async ({ path }: { path: string }) =>
      path === '/home/u' ? listing('/home/u', ['proj', '.cache']) : listing(path, []),
    ),
    ...overrides,
  };
  Object.assign(remotesApi, remotes);
  Object.assign(workspaceApi, { state: async () => emptyState, ...workspace });
  window.delionBot = { bridge } as unknown as DelionBotApi;
  return {
    remotes,
    emit: (progress: RemoteSetupProgress) => listeners.get('remotes:setupProgress')!(progress),
  };
}

async function render(onImported = vi.fn()) {
  await act(async () =>
    root.render(
      <Providers>
        <NewRemoteProjectDialog onClose={() => {}} onImported={onImported} open />
      </Providers>,
    ),
  );
  await flush();
  return onImported;
}

it('connects the first saved server and browses from its home directory', async () => {
  const { remotes } = api();
  await render();
  expect(remotes.prepare).toHaveBeenCalledWith({
    label: '实验室主机',
    host: 'gpu-box',
    port: 2222,
    keyPath: null,
  });
  expect(remotes.browse).toHaveBeenCalledWith({
    draft: expect.objectContaining({ host: 'gpu-box' }),
    path: '/home/u',
  });
  expect(document.body.textContent).toContain('proj');
  expect(document.body.textContent).not.toContain('.cache');
  expect(input('项目名称').value).toBe('u');
});

it('selects on click, enters on double click, and imports under a custom name', async () => {
  const importRemoteProject = vi.fn(async () => created);
  const state = vi.fn(async () => ({ ...emptyState, entries: [created] }));
  const { remotes } = api({}, { importRemoteProject, state });
  const onImported = await render();

  const row = () => [...document.querySelectorAll<HTMLButtonElement>('[role="option"] button')][0]!;
  await act(async () => row().click());
  expect(input('项目名称').value).toBe('proj');
  expect(document.body.textContent).toContain('~/proj');

  await act(async () => setValue(input('项目名称'), '我的实验'));
  await act(async () => row().dispatchEvent(new MouseEvent('dblclick', { bubbles: true })));
  await flush();
  expect(remotes.browse).toHaveBeenLastCalledWith(
    expect.objectContaining({ path: '/home/u/proj' }),
  );
  expect(input('项目名称').value).toBe('我的实验');

  await act(async () => button('添加项目').click());
  expect(importRemoteProject).toHaveBeenCalledWith({
    remoteId: 'r-1',
    path: '/home/u/proj',
    name: '我的实验',
  });
  expect(onImported).toHaveBeenCalledWith(created);
  expect(usePreferences.getState().remoteLastDirectory['gpu-box']).toBe('/home/u/proj');
});

it('saves an ~/.ssh/config host as a connection when it is picked', async () => {
  const added: RemoteConnection = { ...saved, id: 'r-2', label: 'lab', host: 'lab', port: null };
  let list = [saved];
  const save = vi.fn(async () => {
    list = [saved, added];
    return added;
  });
  const { remotes } = api({
    list: vi.fn(async () => list),
    configHosts: vi.fn(async () => [{ alias: 'lab', hostName: '10.0.0.9', user: 'u', port: null }]),
    save,
  });
  await render();

  await act(async () =>
    document
      .querySelector('[aria-label="服务器"]')!
      .dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })),
  );
  const option = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find((item) =>
    item.textContent?.includes('10.0.0.9'),
  )!;
  expect(option.textContent).toContain('lab');
  await act(async () =>
    option.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })),
  );
  await flush();
  expect(save).toHaveBeenCalledWith({ label: 'lab', host: 'lab', port: null, keyPath: null });
  expect(remotes.prepare).toHaveBeenLastCalledWith(expect.objectContaining({ host: 'lab' }));
});
