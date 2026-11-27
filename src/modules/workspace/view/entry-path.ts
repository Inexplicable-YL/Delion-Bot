import type { WorkspaceEntry } from '../contract';

export function workspaceEntryPath(entries: WorkspaceEntry[], id: string): string[] {
  const entry = entries.find((item) => item.id === id);
  if (!entry) return [];
  return entry.parentId
    ? [...workspaceEntryPath(entries, entry.parentId), entry.name]
    : [entry.name];
}

export function isChatStoragePath(directory: string, path: string): boolean {
  const comparable = (value: string) => {
    const normalized = value.replaceAll('\\', '/');
    return /^[a-z]:/i.test(normalized) ? normalized.toLowerCase() : normalized;
  };
  const root = comparable(directory).replace(/\/+$/, '');
  const target = comparable(path);
  return ['chat-sessions', 'chat-share'].some((folder) => target.startsWith(`${root}/${folder}/`));
}
