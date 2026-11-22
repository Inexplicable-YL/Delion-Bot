import { ProjectChangeTabStatus } from '../../../modules/chat/view';
import { useRef, useState, type DragEvent, type KeyboardEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { XMarkIcon as X } from '@heroicons/react/24/outline';
import type { GroupNode, TabId } from '../../../modules/workspace/contract';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from '../../../ui/ContextMenu';
import { cn } from '../../../ui/cn';
import { horizontalWheelRef } from '../../../ui/use-horizontal-wheel';
import { useWorkbenchLayout } from './layout-store';
import { kindOf, registry, titleOf } from './registry';
import { fileIconUrl } from '../../../modules/workspace/view';
import { ExplorerRevealButton } from './ExplorerState';
import { encodeTabDrag, hasTabDrag, parseTabDrag, setCurrentTabDrag, tabDragType } from './tab-dnd';
import { GroupToolbar } from './GroupToolbar';
import { IconButton } from '../../../ui/IconButton';
import { openDroppedSession, sessionDragType } from '../navigation/session-dnd';

export function TabBar({
  group,
  unfocused,
  showReveal,
}: {
  group: GroupNode;
  unfocused: boolean;
  showReveal: boolean;
}) {
  const queryClient = useQueryClient();
  const openTab = useWorkbenchLayout((s) => s.openTab);
  const closeTab = useWorkbenchLayout((s) => s.closeTab);
  const closeTabs = useWorkbenchLayout((s) => s.closeTabs);
  const moveTab = useWorkbenchLayout((s) => s.moveTab);
  const togglePin = useWorkbenchLayout((s) => s.togglePin);
  const keepTab = useWorkbenchLayout((s) => s.keepTab);
  const tabRefs = useRef(new Map<TabId, HTMLDivElement>());
  const [revealActiveTab] = useState(() => {
    let revealed: HTMLDivElement | null = null;
    return (element: HTMLDivElement, active: boolean) => {
      if (!active) {
        if (revealed === element) revealed = null;
        return;
      }
      if (revealed === element) return;
      revealed = element;
      element.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    };
  });

  const setTabRef = (tab: TabId) => (element: HTMLDivElement | null) => {
    if (!element) return;
    tabRefs.current.set(tab, element);
    revealActiveTab(element, tab === group.active);
    return () => {
      tabRefs.current.delete(tab);
    };
  };

  const onTabKeyDown = (event: KeyboardEvent<HTMLDivElement>, tab: TabId) => {
    if (event.target !== event.currentTarget) return;
    const index = group.tabs.indexOf(tab);
    let targetIndex: number;
    switch (event.key) {
      case 'ArrowLeft':
        targetIndex = (index - 1 + group.tabs.length) % group.tabs.length;
        break;
      case 'ArrowRight':
        targetIndex = (index + 1) % group.tabs.length;
        break;
      case 'Home':
        targetIndex = 0;
        break;
      case 'End':
        targetIndex = group.tabs.length - 1;
        break;
      case 'Enter':
      case ' ':
        event.preventDefault();
        openTab(tab, group.id);
        return;
      default:
        return;
    }
    event.preventDefault();
    const target = group.tabs[targetIndex]!;
    openTab(target, group.id);
    tabRefs.current.get(target)?.focus();
  };

  const onDragOver = (event: DragEvent<HTMLDivElement>) => {
    if (!hasTabDrag(event.dataTransfer) && !event.dataTransfer.types.includes(sessionDragType))
      return;
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = 'move';
  };
  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    const fromSidebar = event.dataTransfer.types.includes(sessionDragType);
    if (!fromSidebar && !hasTabDrag(event.dataTransfer)) return;
    if (event.defaultPrevented) return;
    event.preventDefault();
    event.stopPropagation();
    const target = (event.target as HTMLElement).closest<HTMLElement>('[data-tab]');
    let index = group.tabs.length;
    if (target) {
      const tab = target.dataset.tab as TabId;
      index = Math.max(0, group.tabs.indexOf(tab));
      const rect = target.getBoundingClientRect();
      if (event.clientX > rect.left + rect.width / 2) index += 1;
    }
    if (fromSidebar) {
      openDroppedSession(event.dataTransfer, group.id, index);
      return;
    }
    const payload = parseTabDrag(event.dataTransfer.getData(tabDragType));
    setCurrentTabDrag(null);
    if (!payload) return;
    moveTab(payload.tabId, payload.fromGroup, group.id, index);
  };

  const activeTab = group.active;
  if (!group.tabs.length) return null;

  return (
    <div className="relative z-raised @container flex min-h-toolbar min-w-0 shrink-0 items-center gap-2 px-app">
      {showReveal && <ExplorerRevealButton className="self-center" />}
      <div
        ref={horizontalWheelRef}
        role="tablist"
        aria-label={activeTab ? `标签页：${titleOf(activeTab, queryClient)}` : '工作组标签页'}
        className="glass flex min-w-0 flex-1 items-center gap-1 overflow-x-auto rounded-full p-1 [scrollbar-width:none]"
        onDragOver={onDragOver}
        onDrop={onDrop}
      >
        {group.tabs.map((tab) => {
          const active = group.active === tab;
          const isPinned = group.pinned?.includes(tab) ?? false;
          const isPreview = group.preview === tab;
          const { icon: Icon, file } = registry[kindOf(tab)];
          const title = titleOf(tab, queryClient);
          const fileIcon = file ? fileIconUrl(title) : null;
          return (
            <ContextMenu key={tab}>
              <ContextMenuTrigger asChild>
                <div
                  aria-controls={`tabpanel-${group.id}`}
                  aria-selected={active}
                  data-tab={tab}
                  data-active={active}
                  draggable
                  id={`tab-${group.id}-${tab}`}
                  ref={setTabRef(tab)}
                  role="tab"
                  tabIndex={active ? 0 : -1}
                  className={cn(
                    'group/tab relative flex min-h-control-sm touch:min-h-control-lg min-w-32 max-w-56 shrink-0 select-none items-center gap-1.5 px-1.5 outline-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent-ink',
                    'rounded-full',
                    active ? 'bg-surface text-ink shadow-hairline' : 'text-ink-2 hover:bg-hover',
                  )}
                  onClick={() => openTab(tab, group.id)}
                  onDoubleClick={() => keepTab(tab, group.id)}
                  onKeyDown={(event) => onTabKeyDown(event, tab)}
                  onDragStart={(event) => {
                    setCurrentTabDrag({ tabId: tab, fromGroup: group.id });
                    event.dataTransfer.effectAllowed = 'move';
                    event.dataTransfer.setData(
                      tabDragType,
                      encodeTabDrag({ tabId: tab, fromGroup: group.id }),
                    );
                  }}
                  onDragEnd={() => setCurrentTabDrag(null)}
                  onAuxClick={(event) => {
                    if (event.button !== 1) return;
                    event.preventDefault();
                    if (!isPinned) closeTab(tab, group.id);
                  }}
                >
                  {fileIcon ? (
                    <img alt="" className="size-4 shrink-0" draggable={false} src={fileIcon} />
                  ) : (
                    <Icon className="size-4 shrink-0" />
                  )}
                  <div className="flex min-w-0 flex-1 items-center gap-1">
                    <span
                      className={cn(
                        'min-w-0 truncate px-0.5 text-left text-ui-subhead',
                        isPreview && 'italic',
                        unfocused && 'text-ink-2',
                      )}
                      title={isPreview ? `${title}（预览，双击保留）` : title}
                    >
                      {title}
                    </span>
                    <ProjectChangeTabStatus tabId={tab} />
                  </div>
                  {!isPinned && (
                    <IconButton
                      size="xs"
                      aria-hidden
                      className="relative after:absolute after:-inset-1 after:content-['']"
                      tabIndex={-1}
                      onClick={(event) => {
                        event.stopPropagation();
                        closeTab(tab, group.id);
                      }}
                    >
                      <X />
                    </IconButton>
                  )}
                </div>
              </ContextMenuTrigger>
              <ContextMenuContent>
                {isPreview && (
                  <ContextMenuItem onSelect={() => keepTab(tab, group.id)}>保留</ContextMenuItem>
                )}
                <ContextMenuItem onSelect={() => togglePin(tab, group.id)}>
                  {isPinned ? '取消固定' : '固定'}
                </ContextMenuItem>
                <ContextMenuItem onSelect={() => closeTab(tab, group.id)}>关闭</ContextMenuItem>
                <ContextMenuItem onSelect={() => closeTabs(group.id, 'others', tab)}>
                  关闭其他
                </ContextMenuItem>
                <ContextMenuItem
                  disabled={
                    !group.tabs
                      .slice(group.tabs.indexOf(tab) + 1)
                      .some((right) => !(group.pinned ?? []).includes(right))
                  }
                  onSelect={() => closeTabs(group.id, 'right', tab)}
                >
                  关闭右侧
                </ContextMenuItem>
              </ContextMenuContent>
            </ContextMenu>
          );
        })}
      </div>
      <GroupToolbar group={group} />
    </div>
  );
}
