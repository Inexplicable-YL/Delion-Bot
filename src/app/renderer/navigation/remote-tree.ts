import { useState } from 'react';
import { useQueries, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { type WorkspaceEntry, hiddenWorkspaceNames } from '../../../modules/workspace/contract';
import type { RemoteDirectoryEntry } from '../../../modules/remotes/contract';
import { remoteNodeId } from '../../../modules/remotes/contract';
import { onWorkspaceEvent, workspaceClient } from '../../../modules/workspace/view';
import { remoteAccent, useRemoteChannels } from '../../../modules/remotes/view';
import type { ExplorerItem } from '../../../modules/workspace/view';
import { useRemoteActivity } from './remote-activity';
import { useRemoteConnections } from './remote-connections';
import { errorMessage } from '../../../core/protocol/contract';

const trimSlash = (path: string) => path.replace(/\/+$/, '');

const CHANGE_DEBOUNCE_MS = 300;

const WATCH_DEBOUNCE_MS = 150;

const directoryQueries = ['workspace', 'listRemoteDirectory'];

const withinChange = (path: string, changed: string) =>
  path === changed || path.startsWith(`${changed}/`);

function connectRemoteDirectoryEvents(queryClient: QueryClient) {
  const changed = new Set<string>();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const unsubscribe = onWorkspaceEvent('remoteChange', (path) => {
    changed.add(trimSlash(path));
    if (timer !== undefined) return;
    timer = setTimeout(() => {
      timer = undefined;
      const paths = [...changed];
      changed.clear();
      void queryClient.invalidateQueries({
        queryKey: directoryQueries,
        predicate: ({ queryKey }) =>
          paths.some((changedPath) => withinChange(queryKey[3] as string, changedPath)),
      });
    }, CHANGE_DEBOUNCE_MS);
  });
  return () => {
    clearTimeout(timer);
    unsubscribe();
  };
}

function createRemoteWatcher() {
  const reported = new Map<string, string>();
  let wanted = new Map<string, string[]>();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const flush = () => {
    timer = undefined;
    for (const projectId of reported.keys()) if (!wanted.has(projectId)) wanted.set(projectId, []);
    for (const [projectId, paths] of wanted) {
      const serialized = paths.join('\n');
      if (reported.get(projectId) === serialized) continue;
      reported.set(projectId, serialized);
      void workspaceClient.watchRemoteDirectories({ projectId, paths }).catch((error: unknown) => {
        console.warn('[workspace] 上报远端监视目录失败', error);
        reported.delete(projectId);
      });
    }
  };
  return {
    report(next: Map<string, string[]>) {
      if (
        next.size === wanted.size &&
        [...next].every(([id, paths]) => paths.join('\0') === wanted.get(id)?.join('\0'))
      )
        return;
      wanted = next;
      timer ??= setTimeout(flush, WATCH_DEBOUNCE_MS);
    },
    dispose() {
      clearTimeout(timer);
      timer = undefined;
      wanted = new Map();
      for (const projectId of reported.keys())
        void workspaceClient.watchRemoteDirectories({ projectId, paths: [] }).catch(() => {});
      reported.clear();
    },
  };
}

export const remoteTitle = (destination: string | undefined, path: string) =>
  destination ? `${destination}:${trimSlash(path)}` : trimSlash(path);

export interface RemoteTree {
  items: ExplorerItem[];
  destinations: Record<string, string>;
  status: string | null;
  degraded: string | null;
  connecting: boolean;
  reportDirectories: () => void;
  watch: () => () => void;
}

export function useRemoteTree(
  entries: WorkspaceEntry[],
  expanded: string[],
  rootId: string | null,
): RemoteTree {
  const queryClient = useQueryClient();
  const setPhase = useRemoteActivity((state) => state.setPhase);
  const rootActivity = useRemoteActivity((state) => (rootId ? state.byProject[rootId] : undefined));
  const connections = useRemoteConnections();
  const destinations = Object.fromEntries(
    Object.entries(connections).map(([id, connection]) => [id, connection.host]),
  );
  const [watcher] = useState(createRemoteWatcher);
  const [watch] = useState(() => () => {
    const unsubscribe = connectRemoteDirectoryEvents(queryClient);
    return () => {
      watcher.dispose();
      unsubscribe();
    };
  });
  const isOpen = (key: string) => key === rootId || expanded.includes(key);

  const projects = entries.filter(
    (entry) => entry.kind === 'project' && entry.remoteId && entry.path,
  );
  const channels = Object.values(useRemoteChannels(projects.length > 0));
  const keyOf = (project: WorkspaceEntry, path: string) =>
    trimSlash(project.path!) === path ? project.id : remoteNodeId(project.id, path);

  const openDirectories: { key: string; projectId: string; path: string; root: boolean }[] = [];
  const visit = (project: WorkspaceEntry, path: string, key: string) => {
    if (!isOpen(key)) return;
    openDirectories.push({ key, projectId: project.id, path, root: key === project.id });
    const listing = queryClient.getQueryData<RemoteDirectoryEntry[]>([
      ...directoryQueries,
      project.id,
      path,
    ]);
    for (const child of listing ?? [])
      if (child.directory) visit(project, child.path, keyOf(project, child.path));
  };
  for (const project of projects) visit(project, trimSlash(project.path!), project.id);

  const results = useQueries({
    queries: openDirectories.map(({ projectId, path, root }) => ({
      queryKey: [...directoryQueries, projectId, path],
      gcTime: 0,
      queryFn: async ({ signal }: { signal: AbortSignal }) => {
        if (root) setPhase(projectId, 'connecting');
        try {
          const items = await workspaceClient.listRemoteDirectory({ projectId, path });
          if (root) if (!signal.aborted) setPhase(projectId, 'ready');
          return items;
        } catch (cause) {
          const reason = `读取失败 ${path}：${errorMessage(cause)}`;
          if (root) if (!signal.aborted) setPhase(projectId, 'failed', reason);
          throw new Error(reason);
        }
      },
    })),
  });
  const listings: Record<string, RemoteDirectoryEntry[]> = {};
  openDirectories.forEach(({ key }, index) => {
    const data = results[index]?.data;
    if (data) listings[key] = data;
  });

  const reportDirectories = () => {
    const byProject = new Map<string, string[]>();
    for (const { projectId, path } of openDirectories)
      byProject.set(projectId, [...(byProject.get(projectId) ?? []), path].sort());
    watcher.report(byProject);
  };

  const items: ExplorerItem[] = [];
  for (const project of projects) {
    if (!isOpen(project.id)) continue;
    const destination = project.remoteId ? destinations[project.remoteId] : undefined;
    const accent = remoteAccent(project.remoteId, 'text');
    const walk = (path: string, parentId: string | null) => {
      for (const child of listings[keyOf(project, path)] ?? []) {
        if (hiddenWorkspaceNames.has(child.name)) continue;
        const childKey = remoteNodeId(project.id, child.path);
        items.push({
          id: childKey,
          parentId,
          name: child.name,
          container: child.directory,
          readOnly: true,
          importable: child.directory,
          accent,
          title: remoteTitle(destination, child.path),
        });
        if (child.directory && expanded.includes(childKey)) walk(child.path, childKey);
      }
    };
    walk(trimSlash(project.path!), project.id === rootId ? null : project.id);
  }

  const status = results.find((result) => result.isError)?.error.message ?? null;

  const visible = channels.filter((channel) =>
    projects.some((project) => destinations[project.remoteId!] === channel.destination),
  );
  const unavailable = visible.find((channel) => channel.state === 'unavailable');
  const reconnecting = visible.find((channel) => channel.state === 'reconnecting');
  const degradedText = unavailable
    ? `${unavailable.destination} 的远程项目暂时不可用：${unavailable.reason}`
    : reconnecting
      ? `与 ${reconnecting.destination} 的连接中断，正在重连；远端正在运行的命令不受影响`
      : null;

  const connecting = rootActivity?.phase === 'connecting' && items.length === 0;

  return {
    items,
    destinations,
    status,
    degraded: degradedText,
    connecting,
    reportDirectories,
    watch,
  };
}
