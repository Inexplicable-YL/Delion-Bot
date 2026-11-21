import { create } from 'zustand';
import { Bars3BottomLeftIcon as PanelLeft } from '@heroicons/react/24/outline';
import { usePreferences } from '../shell/preferences';
import { NARROW_WINDOW_QUERY, useMobileDrawer } from '../shell/mobile-drawer';
import { IconButton } from '../../../ui/IconButton';

type Store = {
  narrow: boolean;
};

export const useExplorerState = create<Store>(() => ({
  narrow: typeof window !== 'undefined' && window.matchMedia(NARROW_WINDOW_QUERY).matches,
}));

if (typeof window !== 'undefined') {
  const media = window.matchMedia(NARROW_WINDOW_QUERY);
  media.addEventListener('change', () => {
    const narrow = media.matches;
    useExplorerState.setState({ narrow });
    if (!narrow) useMobileDrawer.getState().setDrawer(null);
  });
}

export function ExplorerRevealButton({ className }: { className?: string }) {
  const narrow = useExplorerState((s) => s.narrow);
  const mobileOpen = useMobileDrawer((s) => s.drawer === 'explorer');
  const collapsed = usePreferences((s) => s.workspaceSidebarCollapsed);
  const hidden = narrow ? !mobileOpen : collapsed;
  if (!hidden) return null;
  return (
    <IconButton
      aria-label="展开目录"
      className={className}
      onClick={() => {
        const state = useExplorerState.getState();
        if (state.narrow) useMobileDrawer.getState().setDrawer('explorer');
        else usePreferences.getState().setPreference('workspaceSidebarCollapsed', false);
      }}
      title="展开目录"
    >
      <PanelLeft />
    </IconButton>
  );
}
