// @vitest-environment jsdom
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { DelionBotApi } from '../../../../src/app/preload/api';
import type { WorkspaceEntry } from '../../../../src/modules/workspace/contract';

const workspace = vi.hoisted(() => {
  const handlers: Record<string, (input: never) => unknown> = {};
  const remotes: Record<string, (input: never) => unknown> = {};
  const listeners = new Map<string, (payload: unknown) => void>();
  const bridge = {
    invoke: async (channel: string, input: never) => {
      const [namespace, name] = channel.split(':');
      return (namespace === 'remotes' ? remotes : handlers)[name!]?.(input);
    },
    subscribe: (channel: string, listener: (payload: unknown) => void) => {
      listeners.set(channel, listener);
      return () => {};
    },
  };
  window.delionBot = { bridge } as unknown as NonNullable<typeof window.delionBot>;
  return { handlers, remotes, listeners, bridge };
});
import { ProjectFileTree } from '../../../../src/app/renderer/navigation/ProjectFileTree';
import { useRemoteState } from '../../../../src/modules/remotes/view';
import { useRemoteActivity } from '../../../../src/app/renderer/navigation/remote-activity';
import { useWorkspaceStore } from '../../../../src/modules/workspace/view';

let container: HTMLDivElement;
let root: Root;
let client: QueryClient;

const renderUi = (ui: ReactNode) =>
  root.render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);

const remoteProject: WorkspaceEntry = {
  id: 'p-remote',
  parentId: null,
  name: 'proj',
  kind: 'project',
  sourceId: null,
  path: '/home/u/proj',
  remoteId: 'r-1',
  updatedAt: '2026-10-09T00:00:00.000Z',
};

const entries: WorkspaceEntry[] = [remoteProject];

type RemoteListInput = { projectId: string; path: string };

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  for (const name of Object.keys(workspace.handlers)) delete workspace.handlers[name];
  workspace.remotes.list = async () => [];
  workspace.remotes.helperStates = async () => [];
  useRemoteState.setState({ pushedChannels: null });
  useRemoteActivity.setState({ byProject: {} });
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  delete window.delionBot;
  vi.unstubAllGlobals();
});

const settle = async () => {
  for (let tick = 0; tick < 4; tick += 1)
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
};

async function renderTree(
  expanded: string[],
  onSelect = vi.fn(),
  onExpand = vi.fn(),
  rootId: string | null = null,
) {
  await act(async () =>
    renderUi(
      <ProjectFileTree
        entries={entries}
        expanded={expanded}
        onAction={() => {}}
        onExpand={onExpand}
        onSelect={onSelect}
        query=""
        rootId={rootId}
        selected={null}
      />,
    ),
  );
  await settle();
  return { onSelect, onExpand };
}

const row = (name: string) =>
  document.querySelector<HTMLElement>(`[role="treeitem"][aria-label="${name}"]`)!;
it('reads only expanded local directories and releases children when their ancestor closes', async () => {
  const project = { ...remoteProject, id: 'local', remoteId: undefined, path: 'C:/local' };
  const folder = {
    ...project,
    id: 'C:/local/src',
    parentId: project.id,
    kind: 'folder' as const,
    name: 'src',
    path: 'C:/local/src',
  };
  const ensure = vi.spyOn(useWorkspaceStore.getState(), 'ensureDirectory').mockResolvedValue();
  const release = vi.spyOn(useWorkspaceStore.getState(), 'releaseDirectory');
  const render = async (expanded: string[]) => {
    await act(async () =>
      renderUi(
        <ProjectFileTree
          entries={[project, folder]}
          expanded={expanded}
          rootId={null}
          query=""
          selected={null}
          onAction={() => {}}
          onExpand={() => {}}
          onSelect={() => {}}
        />,
      ),
    );
  };
  try {
    await render([]);
    expect(ensure).not.toHaveBeenCalled();
    await render([project.id, folder.id]);
    expect(ensure.mock.calls.map((call) => call[0])).toEqual([folder.id, project.id]);
    ensure.mockClear();
    await render([folder.id]);
    expect(ensure).not.toHaveBeenCalled();
    expect(release).toHaveBeenCalledWith(project.id);
    expect(release).toHaveBeenCalledWith(folder.id);
  } finally {
    ensure.mockRestore();
    release.mockRestore();
  }
});

it('keeps two connections on the same remote path apart', async () => {
  const first: WorkspaceEntry = { ...remoteProject, id: 'p-a', name: 'a', remoteId: 'r-1' };
  const second: WorkspaceEntry = { ...remoteProject, id: 'p-b', name: 'b', remoteId: 'r-2' };
  const listRemoteDirectory = vi.fn(async ({ projectId }: RemoteListInput) =>
    projectId === 'p-a'
      ? [
          {
            name: 'src-a',
            path: '/home/u/proj/src-a',
            directory: true,
            size: null,
            modifiedAt: null,
          },
          {
            name: 'only-a.txt',
            path: '/home/u/proj/only-a.txt',
            directory: false,
            size: 1,
            modifiedAt: null,
          },
        ]
      : [
          {
            name: 'src-b',
            path: '/home/u/proj/src-b',
            directory: true,
            size: null,
            modifiedAt: null,
          },
          {
            name: 'only-b.txt',
            path: '/home/u/proj/only-b.txt',
            directory: false,
            size: 1,
            modifiedAt: null,
          },
        ],
  );
  window.delionBot = { bridge: workspace.bridge } as unknown as DelionBotApi;
  workspace.remotes.list = async () => [];
  workspace.handlers.listRemoteDirectory = listRemoteDirectory;
  const onExpand = vi.fn();

  await act(async () =>
    renderUi(
      <ProjectFileTree
        entries={[first, second]}
        expanded={['p-a', 'p-b']}
        onAction={() => {}}
        onExpand={onExpand}
        onSelect={() => {}}
        query=""
        rootId={null}
        selected={null}
      />,
    ),
  );
  await settle();

  expect(listRemoteDirectory).toHaveBeenCalledWith({ projectId: 'p-a', path: '/home/u/proj' });
  expect(listRemoteDirectory).toHaveBeenCalledWith({ projectId: 'p-b', path: '/home/u/proj' });
  expect(row('only-a.txt')).toBeTruthy();
  expect(row('only-b.txt')).toBeTruthy();

  await act(async () => row('src-a').click());
  expect(onExpand).toHaveBeenCalledWith('p-a:/home/u/proj/src-a', true);
});

it('refreshes a remote directory after the tools changed it', async () => {
  const listRemoteDirectory = vi.fn(async ({ path }: RemoteListInput) =>
    path === '/home/u/proj'
      ? [{ name: 'src', path: '/home/u/proj/src', directory: true, size: null, modifiedAt: null }]
      : [{ name: 'new.txt', path: `${path}/new.txt`, directory: false, size: 1, modifiedAt: null }],
  );
  window.delionBot = { bridge: workspace.bridge } as unknown as DelionBotApi;
  workspace.remotes.list = async () => [];
  workspace.handlers.listRemoteDirectory = listRemoteDirectory;

  await renderTree(['p-remote', 'p-remote:/home/u/proj/src']);
  expect(listRemoteDirectory).toHaveBeenCalledTimes(2);
  expect(listRemoteDirectory).toHaveBeenLastCalledWith({
    projectId: 'p-remote',
    path: '/home/u/proj/src',
  });

  await act(async () => {
    workspace.listeners.get('workspace:remoteChange')!('/elsewhere/dir');
    await new Promise((resolve) => setTimeout(resolve, 350));
  });
  expect(listRemoteDirectory).toHaveBeenCalledTimes(2);

  await act(async () => {
    workspace.listeners.get('workspace:remoteChange')!('/home/u/proj/src');
    await new Promise((resolve) => setTimeout(resolve, 350));
  });
  expect(listRemoteDirectory).toHaveBeenCalledTimes(3);
  expect(listRemoteDirectory).toHaveBeenLastCalledWith({
    projectId: 'p-remote',
    path: '/home/u/proj/src',
  });

  await act(async () => {
    workspace.listeners.get('workspace:remoteChange')!('/home/u/proj');
    await new Promise((resolve) => setTimeout(resolve, 350));
  });
  expect(listRemoteDirectory).toHaveBeenCalledWith({ projectId: 'p-remote', path: '/home/u/proj' });
  expect(listRemoteDirectory).toHaveBeenCalledTimes(5);
});
