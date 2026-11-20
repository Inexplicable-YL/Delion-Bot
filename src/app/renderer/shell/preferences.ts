// 只有界面用、主进程不读的偏好：一个持久化 store，写入只发生在 action 里。
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { useResizerWidth } from '../../../ui/resizer';

export type ProjectNavPreference = { pinned?: boolean; section?: string };

const defaults = {
  shellSidebarCollapsed: false,
  projectOpenTarget: 'vscode' as 'vscode' | 'explorer',
  workspaceSidebarWidth: 300,
  workspaceSidebarCollapsed: false,
  hiddenNavEntries: [] as string[],
  projectNav: {} as Record<string, ProjectNavPreference>,
  remoteLastDirectory: {} as Record<string, string>,
};

type PreferenceValues = typeof defaults;

type PreferencesStore = PreferenceValues & {
  setPreference: <K extends keyof PreferenceValues>(key: K, value: PreferenceValues[K]) => void;
  setNavEntryVisible: (id: string, visible: boolean) => void;
  patchProjectNav: (id: string, patch: ProjectNavPreference) => void;
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
    }),
    {
      name: storageKey,
      version: 1,
      storage: createJSONStorage(() => localStorage),
    },
  ),
);

export function usePreferenceWidth(key: 'workspaceSidebarWidth') {
  const stored = usePreferences((state) => state[key]);
  const setPreference = usePreferences((state) => state.setPreference);
  return useResizerWidth(stored, (width) => setPreference(key, width));
}
