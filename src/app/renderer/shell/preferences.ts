import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { useResizerWidth } from '../../../ui/Resizer';

export type ProjectNavPreference = { pinned?: boolean; section?: string };

export type NavListPreference<Sort extends string> = {
  collapsed: boolean;
  sort: Sort;
  status: 'active' | 'archived' | 'all';
  activityDays: 0 | 1 | 7 | 30;
};
export type ChatListSort = 'updated' | 'created';
export type ProjectListSort = 'updated' | 'name';

const defaults = {
  shellSidebarCollapsed: false,
  projectOpenTarget: 'vscode' as 'vscode' | 'explorer',
  workspaceSidebarWidth: 300,
  workspaceSidebarCollapsed: false,
  hiddenNavEntries: [] as string[],
  projectNav: {} as Record<string, ProjectNavPreference>,
  chatList: {
    collapsed: false,
    sort: 'updated',
    status: 'all',
    activityDays: 0,
  } as NavListPreference<ChatListSort>,
  projectList: {
    collapsed: false,
    sort: 'updated',
    status: 'all',
    activityDays: 0,
  } as NavListPreference<ProjectListSort>,
  remoteLastDirectory: {} as Record<string, string>,
};

type PreferenceValues = typeof defaults;

type PreferencesStore = PreferenceValues & {
  setPreference: <K extends keyof PreferenceValues>(key: K, value: PreferenceValues[K]) => void;
  setNavEntryVisible: (id: string, visible: boolean) => void;
  patchProjectNav: (id: string, patch: ProjectNavPreference) => void;
  patchNavList: <K extends 'chatList' | 'projectList'>(
    key: K,
    patch: Partial<PreferenceValues[K]>,
  ) => void;
};

const storageKey = 'delion.preferences';

export const usePreferences = create<PreferencesStore>()(
  persist(
    (set) => ({
      ...defaults,
      setPreference: (key, value) => set({ [key]: value }),
      setNavEntryVisible: (id, visible) =>
        set((state) => ({
          hiddenNavEntries: visible
            ? state.hiddenNavEntries.filter((item) => item !== id)
            : [...new Set([...state.hiddenNavEntries, id])],
        })),
      patchProjectNav: (id, patch) =>
        set((state) => ({
          projectNav: { ...state.projectNav, [id]: { ...state.projectNav[id], ...patch } },
        })),
      patchNavList: (key, patch) => set((state) => ({ [key]: { ...state[key], ...patch } })),
    }),
    {
      name: storageKey,
      version: 1,
      storage: createJSONStorage(() => localStorage),
      merge: (persisted, current) => {
        const saved = persisted as Partial<PreferenceValues> | undefined;
        return {
          ...current,
          ...saved,
          chatList: { ...current.chatList, ...saved?.chatList },
          projectList: { ...current.projectList, ...saved?.projectList },
        };
      },
    },
  ),
);

export function usePreferenceWidth(key: 'workspaceSidebarWidth') {
  const stored = usePreferences((state) => state[key]);
  const setPreference = usePreferences((state) => state.setPreference);
  return useResizerWidth(stored, (width) => setPreference(key, width));
}
