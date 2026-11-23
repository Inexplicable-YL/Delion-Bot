import { create } from 'zustand';
import type { WorkspaceEntry } from '../../../modules/workspace/contract';

export function ancestorChainOf(entries: WorkspaceEntry[], id: string): string[] {
  const chain = [id];
  let parent = entries.find((e) => e.id === id)?.parentId;
  while (parent) {
    chain.unshift(parent);
    parent = entries.find((e) => e.id === parent)?.parentId;
  }
  return chain;
}

export type PendingCreate = { parentId: string | null; kind: 'file' | 'folder' };

type Store = {
  pendingCreate: PendingCreate | null;
  startCreate: (pending: PendingCreate) => void;
  cancelCreate: () => void;
  query: string;
  setQuery: (query: string) => void;
  expanded: string[];
  expand: (id: string, open: boolean) => void;
  reveal: (chain: string[]) => void;
  folderReveal: { id: string; key: string } | null;
  revealFolder: (chain: string[]) => void;
  collapseAll: () => void;
  selected: string | null;
  select: (id: string | null) => void;
  openProjects: string[];
  toggleProject: (id: string, open?: boolean) => void;
  fullSessionLists: string[];
  toggleFullSessionList: (id: string) => void;
};

export const useTreeState = create<Store>((set) => ({
  pendingCreate: null,
  startCreate: (pending) =>
    set((s) => ({
      pendingCreate: pending,
      expanded: pending.parentId ? [...new Set([...s.expanded, pending.parentId])] : s.expanded,
    })),
  cancelCreate: () => set({ pendingCreate: null }),
  query: '',
  setQuery: (query) => set({ query }),
  expanded: [],
  expand: (id, open) =>
    set((s) => ({
      expanded: open
        ? [...new Set([...s.expanded, id])]
        : s.expanded.filter((value) => value !== id),
    })),
  reveal: (chain) =>
    set((s) => ({
      expanded: [...new Set([...s.expanded, ...chain])],
      selected: chain.at(-1) ?? null,
      folderReveal: null,
    })),
  folderReveal: null,
  revealFolder: (chain) => {
    const id = chain.at(-1);
    if (!id) return;
    set((s) => ({
      expanded: [...new Set([...s.expanded, ...chain])],
      selected: id,
      query: '',
      folderReveal: { id, key: crypto.randomUUID() },
    }));
  },
  collapseAll: () => set({ expanded: [], folderReveal: null }),
  selected: null,
  select: (selected) => set({ selected, folderReveal: null }),
  openProjects: ['general'],
  toggleProject: (id, open) =>
    set((s) => ({
      openProjects:
        (open ?? !s.openProjects.includes(id))
          ? [...new Set([...s.openProjects, id])]
          : s.openProjects.filter((value) => value !== id),
    })),
  fullSessionLists: [],
  toggleFullSessionList: (id) =>
    set((s) => ({
      fullSessionLists: s.fullSessionLists.includes(id)
        ? s.fullSessionLists.filter((value) => value !== id)
        : [...s.fullSessionLists, id],
    })),
}));
