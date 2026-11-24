import type { WorkspaceEntry } from '../../../modules/workspace/contract';

export interface VisibleLeaf {
  id: string;
  active: string | null;
}

export function storageJoin(directory: string, ...parts: string[]): string {
  const separator = directory.includes('\\') ? '\\' : '/';
  return [directory.replace(/[\\/]+$/, ''), ...parts].join(separator);
}

export function chatDeliveryPath(directory: string, sessionId: string): string {
  return storageJoin(directory, 'chat-delivery', sessionId);
}

function chatSessionId(tab: string | null): string | null {
  if (!tab?.startsWith('chat:')) return null;
  const id = tab.slice('chat:'.length);
  return id || null;
}

export function visibleLeafSessions(
  groups: readonly VisibleLeaf[],
  maximizedGroupId: string | null,
): string[] {
  const maximized = maximizedGroupId ? groups.filter((group) => group.id === maximizedGroupId) : [];
  const leaves = maximized.length ? maximized : groups;
  const ids: string[] = [];
  for (const leaf of leaves) {
    const id = chatSessionId(leaf.active);
    if (id && !ids.includes(id)) ids.push(id);
  }
  return ids;
}

function folder(directory: string, session: { id: string; title: string }): WorkspaceEntry {
  const path = chatDeliveryPath(directory, session.id);
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

export function deliveryEntriesWithChildren(
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

export interface DeliveryLibrary {
  mode: 'empty' | 'flat' | 'grouped';
  rootId: string | null;
  selectedId: string | null;
  expandedIds: string[];
  entries: WorkspaceEntry[];
}

export function deliveryLibrary(input: {
  directory: string;
  groups: readonly VisibleLeaf[];
  maximizedGroupId: string | null;
  focusedGroupId: string | null;
  titles: Readonly<Record<string, string>>;
  loaded: readonly WorkspaceEntry[];
}): DeliveryLibrary {
  const ids = visibleLeafSessions(input.groups, input.maximizedGroupId);
  const sessions = ids.map((id) => ({ id, title: input.titles[id] || '新对话' }));
  if (sessions.length === 0)
    return { mode: 'empty', rootId: null, selectedId: null, expandedIds: [], entries: [] };
  if (sessions.length === 1) {
    const root = folder(input.directory, sessions[0]!);
    return {
      mode: 'flat',
      rootId: root.id,
      selectedId: null,
      expandedIds: [root.id],
      entries: deliveryEntriesWithChildren([root], input.loaded),
    };
  }
  const roots = sessions.map((session) => folder(input.directory, session));
  const focused = input.groups.find((group) => group.id === input.focusedGroupId);
  const focusedSession = chatSessionId(focused?.active ?? null);
  const selected = roots.find(
    (entry) =>
      focusedSession !== null && entry.path === chatDeliveryPath(input.directory, focusedSession),
  );
  return {
    mode: 'grouped',
    rootId: null,
    selectedId: selected?.id ?? roots[0]!.id,
    expandedIds: roots.map((entry) => entry.id),
    entries: deliveryEntriesWithChildren(roots, input.loaded),
  };
}
