import type { TabId } from '../../../modules/workspace/contract';
import { useNavigationStore } from '../navigation/view';
import { useWorkbenchLayout } from './layout-store';
import { walkGroups } from './layout-schema';

export function purgeRemovedEntries(liveIds: Set<string>): void {
  const layout = useWorkbenchLayout.getState();
  const keep = (tabId: TabId) =>
    tabId.startsWith('chat:') ||
    tabId.startsWith('preview:source:') ||
    liveIds.has(tabId.slice(tabId.indexOf(':') + 1));
  for (const group of walkGroups(layout.root))
    for (const tab of group.tabs) if (!keep(tab)) layout.closeTab(tab, group.id);
  const navigation = useNavigationStore.getState();
  if (navigation.projectId !== null && !liveIds.has(navigation.projectId)) {
    if (navigation.view === 'workbench') navigation.openProject('');
    else useNavigationStore.setState({ projectId: null });
  }
  const deadRoute = (route: { projectId: string | null }) =>
    route.projectId !== null && !liveIds.has(route.projectId);
  useNavigationStore.setState((state) => ({
    backStack: state.backStack.filter((route) => !deadRoute(route)),
    forwardStack: state.forwardStack.filter((route) => !deadRoute(route)),
  }));
}
