import { Suspense, useRef, useState, type DragEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { GroupNode, TabId } from '../../../modules/workspace/contract';
import { ErrorBoundary } from '../shell/ErrorBoundary';
import { cn } from '../../../ui/cn';
import { GroupEmptyState } from './GroupEmptyState';
import { ExplorerRevealButton } from './ExplorerState';
import { walkGroups } from './layout-schema';
import { useWorkbenchLayout } from './layout-store';
import { kindOf, registry, titleOf } from './registry';
import { TabBar } from './TabBar';
import { openDroppedSession, sessionDragType } from '../navigation/session-dnd';
import {
  getCurrentTabDrag,
  hasTabDrag,
  parseTabDrag,
  setCurrentTabDrag,
  tabDragType,
  tabDropZone,
  type EdgeZone,
} from './tab-dnd';

function TabSuspenseFallback() {
  return <div className="min-h-0 min-w-0 flex-1" />;
}

function GroupTabContent({ groupId, tabId }: { groupId: string; tabId: TabId }) {
  const Component = registry[kindOf(tabId)].component;
  return (
    <Suspense fallback={<TabSuspenseFallback />}>
      <Component key={`${groupId}:${tabId}`} groupId={groupId} tabId={tabId} />
    </Suspense>
  );
}

const dropPreviewClass: Record<EdgeZone | 'center', string> = {
  left: 'top-0 left-0 h-full w-1/2',
  right: 'top-0 left-1/2 h-full w-1/2',
  top: 'top-0 left-0 h-1/2 w-full',
  bottom: 'top-1/2 left-0 h-1/2 w-full',
  center: 'top-0 left-0 h-full w-full',
};

export function TabGroup({ group, onNewChat }: { group: GroupNode; onNewChat: () => void }) {
  const unfocused = useWorkbenchLayout((s) => s.maximized === null && s.focus !== group.id);
  const revealAnchor = useWorkbenchLayout(
    (s) => (s.maximized ?? walkGroups(s.root)[0]?.id ?? null) === group.id,
  );
  const focusGroup = useWorkbenchLayout((s) => s.focusGroup);
  const moveTab = useWorkbenchLayout((s) => s.moveTab);
  const moveTabToEdge = useWorkbenchLayout((s) => s.moveTabToEdge);
  const [dropPreview, setDropPreview] = useState<{ zone: EdgeZone | 'center'; visible: boolean }>({
    zone: 'center',
    visible: false,
  });
  const contentRef = useRef<HTMLDivElement>(null);
  const clearDropPreview = () =>
    setDropPreview((previous) => (previous.visible ? { ...previous, visible: false } : previous));

  const listenForDragEnd = (element: HTMLElement | null) => {
    if (!element || !dropPreview.visible) return;
    const clear = clearDropPreview;
    window.addEventListener('dragend', clear);
    window.addEventListener('drop', clear);
    return () => {
      window.removeEventListener('dragend', clear);
      window.removeEventListener('drop', clear);
    };
  };

  const zoneAt = (event: DragEvent<HTMLElement>) => {
    const rect = contentRef.current!.getBoundingClientRect();
    return tabDropZone(
      (event.clientX - rect.left) / rect.width,
      (event.clientY - rect.top) / rect.height,
    );
  };

  const onDragOver = (event: DragEvent<HTMLElement>) => {
    const fromSidebar = event.dataTransfer.types.includes(sessionDragType);
    if (!hasTabDrag(event.dataTransfer) && !(fromSidebar && !group.tabs.length)) return;
    if (!contentRef.current?.contains(event.target as Node)) {
      clearDropPreview();
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = 'move';
    if (fromSidebar) return;
    const zone = zoneAt(event);
    const sameGroup = getCurrentTabDrag()?.fromGroup === group.id;
    if (sameGroup && (!zone || group.tabs.length === 1)) {
      clearDropPreview();
      return;
    }
    const previewZone = zone ?? 'center';
    setDropPreview((previous) =>
      previous.visible && previous.zone === previewZone
        ? previous
        : { zone: previewZone, visible: true },
    );
  };
  const onDragLeave = (event: DragEvent<HTMLElement>) => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
      clearDropPreview();
    }
  };
  const onDrop = (event: DragEvent<HTMLElement>) => {
    const fromSidebar = event.dataTransfer.types.includes(sessionDragType);
    if (!hasTabDrag(event.dataTransfer) && !(fromSidebar && !group.tabs.length)) return;
    if (!contentRef.current?.contains(event.target as Node)) return;
    event.preventDefault();
    event.stopPropagation();
    clearDropPreview();
    if (fromSidebar) {
      openDroppedSession(event.dataTransfer, group.id);
      return;
    }
    const zone = zoneAt(event);
    const payload = parseTabDrag(event.dataTransfer.getData(tabDragType));
    setCurrentTabDrag(null);
    if (!payload) return;
    if (!zone && payload.fromGroup === group.id) return;
    if (zone) moveTabToEdge(payload.tabId, payload.fromGroup, group.id, zone);
    else moveTab(payload.tabId, payload.fromGroup, group.id);
  };

  const active = group.active;
  const queryClient = useQueryClient();

  return (
    <section
      ref={listenForDragEnd}
      aria-label={active ? `工作组：${titleOf(active, queryClient)}` : '工作组'}
      className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden @container"
      onPointerDown={() => focusGroup(group.id)}
      onDragOverCapture={onDragOver}
      onDragLeave={onDragLeave}
      onDropCapture={onDrop}
    >
      <TabBar group={group} unfocused={unfocused} showReveal={revealAnchor} />

      {revealAnchor && !group.tabs.length && (
        <ExplorerRevealButton className="absolute left-2 top-2 z-10" />
      )}
      <div ref={contentRef} className="relative flex min-h-0 min-w-0 flex-1 flex-col">
        {active ? (
          <div
            aria-labelledby={`tab-${group.id}-${active}`}
            className="flex min-h-0 min-w-0 flex-1 flex-col"
            id={`tabpanel-${group.id}`}
            role="tabpanel"
          >
            <ErrorBoundary key={active} title="此标签遇到错误">
              <GroupTabContent groupId={group.id} tabId={active} />
            </ErrorBoundary>
          </div>
        ) : (
          <GroupEmptyState onNewChat={onNewChat} />
        )}

        <div
          aria-hidden
          className={cn(
            'pointer-events-none absolute z-10 rounded-card ring-1 ring-inset ring-line-strong transition-opacity duration-base ease-out motion-reduce:transition-none',
            dropPreviewClass[dropPreview.zone],
            dropPreview.visible ? 'opacity-100' : 'opacity-0',
          )}
        />
      </div>
    </section>
  );
}
