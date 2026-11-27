import { usePreferences } from '../shell/preferences';
import { NARROW_WINDOW_QUERY } from '../shell/mobile-drawer';

export function explorerWidth(preferred: number, viewportWidth: number): number {
  return Math.min(preferred, Math.max(200, Math.round(viewportWidth * 0.28)));
}

export function explorerSqueezesTabs(): boolean {
  const surface = document.querySelector('[data-workbench-surface]');
  const { workspaceSidebarCollapsed, workspaceSidebarWidth } = usePreferences.getState();
  if (!surface || workspaceSidebarCollapsed || window.matchMedia(NARROW_WINDOW_QUERY).matches)
    return false;
  const root = getComputedStyle(document.documentElement);
  const readingWidth =
    parseFloat(root.getPropertyValue('--container-reading')) * parseFloat(root.fontSize);
  const tabsWidth = surface.clientWidth - explorerWidth(workspaceSidebarWidth, window.innerWidth);
  return tabsWidth < readingWidth;
}
