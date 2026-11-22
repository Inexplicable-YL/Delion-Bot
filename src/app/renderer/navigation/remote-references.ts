import { skipToken, useQuery, type QueryClient } from '@tanstack/react-query';
import type { WorkspaceEntry } from '../../../modules/workspace/contract';
import { onWorkspaceEvent, workspaceClient } from '../../../modules/workspace/view';

export interface RemoteReference {
  key: string;
  title: string;
}

const noRemoteReferences: RemoteReference[] = [];
const noLocalFiles: WorkspaceEntry[] = [];

const LOCAL_CHANGE_DEBOUNCE_MS = 300;

const normalized = (value: string) =>
  /^[a-z]:[\\/]/i.test(value) ? value.replaceAll('\\', '/').toLowerCase() : value;

const localReferencesKey = (cwd: string | null) => ['workspace', 'localReferenceFiles', cwd];

export function connectLocalWorkspaceQueries(queryClient: QueryClient) {
  const pending = new Map<string, ReturnType<typeof setTimeout>>();
  onWorkspaceEvent('changed', (paths) => {
    void queryClient.invalidateQueries({ queryKey: ['workspace', 'search-local'] });
    const changed = paths.map(normalized);
    for (const query of queryClient.getQueryCache().findAll({
      queryKey: ['workspace', 'localReferenceFiles'],
    })) {
      const cwd = query.queryKey[2];
      if (typeof cwd !== 'string') continue;
      const root = normalized(cwd).replace(/\/$/, '');
      if (!changed.some((path) => path === root || path.startsWith(`${root}/`))) continue;
      clearTimeout(pending.get(cwd));
      pending.set(
        cwd,
        setTimeout(() => {
          pending.delete(cwd);
          void queryClient.invalidateQueries({ queryKey: localReferencesKey(cwd), exact: true });
        }, LOCAL_CHANGE_DEBOUNCE_MS),
      );
    }
  });
}

export function useLocalReferences(cwd: string | null): WorkspaceEntry[] {
  const files = useQuery({
    queryKey: localReferencesKey(cwd),
    queryFn: cwd
      ? () =>
          workspaceClient.localReferenceFiles(cwd).catch((error: unknown) => {
            console.error('[workspace] 读取引用候选失败', error);
            throw error;
          })
      : skipToken,
  });

  return files.data ?? noLocalFiles;
}

export function useRemoteReferences(projectId: string | null): RemoteReference[] {
  return (
    useQuery({
      queryKey: ['workspace', 'remoteReferences', projectId],
      queryFn: projectId ? () => workspaceClient.remoteReferences(projectId) : skipToken,
      staleTime: Infinity,
      gcTime: Infinity,
    }).data ?? noRemoteReferences
  );
}
