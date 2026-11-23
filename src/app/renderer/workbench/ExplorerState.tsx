import { create } from 'zustand';
import { Bars3BottomLeftIcon as PanelLeft } from '@heroicons/react/24/outline';
import { usePreferences } from '../shell/preferences';
import { NARROW_WINDOW_QUERY, useMobileDrawer } from '../shell/mobile-drawer';
import { IconButton } from '../../../ui/IconButton';
import { useWorkbenchLayout } from './layout-store';

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

export function useExplorerVisible(): boolean {
  const narrow = useExplorerState((s) => s.narrow);
  const collapsedForReply = useWorkbenchLayout((s) => s.explorerCollapsedForReply);
  const mobileOpen = useMobileDrawer((s) => s.drawer === 'explorer');
  const collapsed = usePreferences((s) => s.workspaceSidebarCollapsed);
  return narrow ? mobileOpen : !collapsed && !collapsedForReply;
}

export function showExplorer() {
  if (useExplorerState.getState().narrow) useMobileDrawer.getState().setDrawer('explorer');
  else {
    useWorkbenchLayout.setState({ explorerCollapsedForReply: false });
    usePreferences.getState().setPreference('workspaceSidebarCollapsed', false);
  }
}

export function ExplorerRevealButton({ className }: { className?: string }) {
  if (useExplorerVisible()) return null;
  return (
    <IconButton aria-label="展开目录" className={className} onClick={showExplorer} title="展开目录">
      <PanelLeft />
    </IconButton>
  );
}
