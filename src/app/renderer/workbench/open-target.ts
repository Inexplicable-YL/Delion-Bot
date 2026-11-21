import type { TabId } from '../../../modules/workspace/contract';
import { findGroup, walkGroups } from './layout-schema';
import { previewable, useWorkbenchLayout } from './layout-store';

function groupRightOfFocus(): string | null {
  const { root, focus } = useWorkbenchLayout.getState();
  const groups = walkGroups(root);
  const index = groups.findIndex((group) => group.id === focus);
  return groups[index + 1]?.id ?? null;
}

export function openTarget(tabId: TabId, options: { aside?: boolean } = {}): void {
  const store = useWorkbenchLayout.getState();
  const preview = previewable(tabId) && store.projectId !== null;
  if (!options.aside) {
    store.openTab(tabId, undefined, { preview });
    return;
  }
  if (!previewable(tabId) && walkGroups(store.root).some((group) => group.tabs.includes(tabId))) {
    store.openTab(tabId);
    return;
  }
  let target = groupRightOfFocus();
  if (!target && store.ready) {
    const focus = findGroup(store.root, store.focus);
    if (focus?.active) {
      store.splitGroup(focus.id, 'vertical', true);
      target = useWorkbenchLayout.getState().focus;
    }
  }
  useWorkbenchLayout.getState().openTab(tabId, target ?? undefined, { preview });
}
