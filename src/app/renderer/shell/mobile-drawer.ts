import { create } from 'zustand';

export const NARROW_WINDOW_QUERY = '(width < 64rem)';

export type MobileDrawer = 'nav' | 'page' | 'explorer';

export const useMobileDrawer = create<{
  drawer: MobileDrawer | null;
  setDrawer: (drawer: MobileDrawer | null) => void;
}>((set) => ({
  drawer: null,
  setDrawer: (drawer) => set({ drawer }),
}));
