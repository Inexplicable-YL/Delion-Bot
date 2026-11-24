import type { WorkspaceEntry } from '../../../modules/workspace/contract';

export interface VisibleLeaf {
  id: string;
  active: string | null;
}

export function storageJoin(directory: string, ...parts: string[]): string {
  const separator = directory.includes('\\') ? '\\' : '/';
  return [directory.replace(/[\\/]+$/, ''), ...parts].join(separator);
}

export function chatSharePath(directory: string, sessionId: string): string {
  return storageJoin(directory, 'chat-share', sessionId);
}

export function shareTarget(
  directory: string,
  tab: string | null,
): { sessionId: string; file: string | null } | null {
  if (!tab) return null;
  if (tab.startsWith('chat:')) {
    const sessionId = tab.slice('chat:'.length);
    return sessionId ? { sessionId, file: null } : null;
  }
  const payload = /^(?:note|preview|review):/.test(tab) ? tab.slice(tab.indexOf(':') + 1) : tab;
  if (!/^(?:[a-z]:[\\/]|\\\\|\/)/i.test(payload)) return null;
  const root = storageJoin(directory, 'chat-share').replaceAll('\\', '/').replace(/\/$/, '');
  const path = payload.replaceAll('\\', '/');
  const comparable = (value: string) => (/^[a-z]:/i.test(value) ? value.toLowerCase() : value);
  const base = comparable(root);
  const current = comparable(path);
  if (current !== base && !current.startsWith(`${base}/`)) return null;
  const rest = path.slice(root.length).replace(/^\//, '');
  const cut = rest.indexOf('/');
  const sessionId = cut === -1 ? rest : rest.slice(0, cut);
  if (!sessionId || sessionId === '.' || sessionId === '..') return null;
  return { sessionId, file: cut === -1 ? null : payload };
}

export function visibleLeafSessions(
  directory: string,
  groups: readonly VisibleLeaf[],
  maximizedGroupId: string | null,
): string[] {
  const maximized = maximizedGroupId ? groups.filter((group) => group.id === maximizedGroupId) : [];
  const leaves = maximized.length ? maximized : groups;
  const ids: string[] = [];
  for (const leaf of leaves) {
    const id = shareTarget(directory, leaf.active)?.sessionId;
    if (id && !ids.includes(id)) ids.push(id);
  }
  return ids;
}

function expandedShareIds(directory: string, sessionId: string, file: string | null): string[] {
  const root = chatSharePath(directory, sessionId);
  const ids = [root];
  if (!file) return ids;
  const normalizedRoot = root.replaceAll('\\', '/');
  const normalizedFile = file.replaceAll('\\', '/');
  if (!normalizedFile.startsWith(`${normalizedRoot}/`)) return ids;
  let current = root;
  for (const part of normalizedFile
    .slice(normalizedRoot.length + 1)
    .split('/')
    .slice(0, -1)) {
    current = storageJoin(current, part);
    ids.push(current);
  }
  return ids;
}

function folder(directory: string, session: { id: string; title: string }): WorkspaceEntry {
  const path = chatSharePath(directory, session.id);
  return {
    id: path,
    parentId: null,
    name: session.title || '新对话',
    kind: 'folder',
    sourceId: null,
    path,
    updatedAt: '',
  };
}

export function shareEntriesWithChildren(
  roots: readonly WorkspaceEntry[],
  loaded: readonly WorkspaceEntry[],
): WorkspaceEntry[] {
  const kept = new Map(roots.map((entry) => [entry.id, entry]));
  let changed = true;
  while (changed) {
    changed = false;
    for (const entry of loaded) {
      if (kept.has(entry.id) || !entry.parentId || !kept.has(entry.parentId)) continue;
      kept.set(entry.id, entry);
      changed = true;
    }
  }
  return [...kept.values()];
}

export interface ShareLibrary {
  mode: 'empty' | 'flat' | 'grouped';
  rootId: string | null;
  selectedId: string | null;
  expandedIds: string[];
  entries: WorkspaceEntry[];
  sectionTitle: string | null;
}

export function shareLibrary(input: {
  directory: string;
  groups: readonly VisibleLeaf[];
  maximizedGroupId: string | null;
  focusedGroupId: string | null;
  titles: Readonly<Record<string, string>>;
  loaded: readonly WorkspaceEntry[];
}): ShareLibrary {
  const ids = visibleLeafSessions(input.directory, input.groups, input.maximizedGroupId);
  const sessions = ids.map((id) => ({ id, title: input.titles[id] || '新对话' }));
  if (sessions.length === 0)
    return {
      mode: 'empty',
      rootId: null,
      selectedId: null,
      expandedIds: [],
      entries: [],
      sectionTitle: null,
    };
  const visibleGroups = input.maximizedGroupId
    ? input.groups.filter((group) => group.id === input.maximizedGroupId)
    : input.groups;
  const focused =
    visibleGroups.find((group) => group.id === input.focusedGroupId) ?? visibleGroups[0];
  const focusedTarget = shareTarget(input.directory, focused?.active ?? null);
  const focusedFile =
    focusedTarget && ids.includes(focusedTarget.sessionId) ? focusedTarget.file : null;
  const expandedIds = [
    ...new Set(
      sessions.flatMap((session) =>
        expandedShareIds(
          input.directory,
          session.id,
          focusedTarget?.sessionId === session.id ? focusedFile : null,
        ),
      ),
    ),
  ];
  if (sessions.length === 1) {
    const root = folder(input.directory, sessions[0]!);
    return {
      mode: 'flat',
      rootId: root.id,
      selectedId: focusedFile,
      expandedIds,
      entries: shareEntriesWithChildren([root], input.loaded),
      sectionTitle: sessions[0]!.title,
    };
  }
  const roots = sessions.map((session) => folder(input.directory, session));
  const selectedFolder = roots.find(
    (entry) =>
      focusedTarget !== null &&
      entry.path === chatSharePath(input.directory, focusedTarget.sessionId),
  );
  return {
    mode: 'grouped',
    rootId: null,
    selectedId: focusedFile ?? selectedFolder?.id ?? roots[0]!.id,
    expandedIds,
    entries: shareEntriesWithChildren(roots, input.loaded),
    sectionTitle: null,
  };
}
