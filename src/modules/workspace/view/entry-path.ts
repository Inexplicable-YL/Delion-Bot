import type { WorkspaceEntry } from '../contract';

export function workspaceEntryPath(entries: WorkspaceEntry[], id: string): string[] {
  const entry = entries.find((item) => item.id === id);
  if (!entry) return [];
  return entry.parentId
    ? [...workspaceEntryPath(entries, entry.parentId), entry.name]
    : [entry.name];
}
