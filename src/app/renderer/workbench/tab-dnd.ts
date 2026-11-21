import type { TabId } from '../../../modules/workspace/contract';

export const tabDragType = 'application/x-delion-tab';

export interface TabDragPayload {
  tabId: TabId;
  fromGroup: string;
}

const tabIdPattern = /^(?:chat|note|preview|review):.+$/;

export function encodeTabDrag(payload: TabDragPayload): string {
  return JSON.stringify(payload);
}

export function parseTabDrag(raw: string | null | undefined): TabDragPayload | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<TabDragPayload>;
    if (
      typeof value.tabId !== 'string' ||
      !tabIdPattern.test(value.tabId) ||
      typeof value.fromGroup !== 'string' ||
      !value.fromGroup
    )
      return null;
    return { tabId: value.tabId as TabId, fromGroup: value.fromGroup };
  } catch {
    return null;
  }
}

export function hasTabDrag(dataTransfer: { types: readonly string[] }): boolean {
  return dataTransfer.types.includes(tabDragType);
}

const edgeZones = ['left', 'right', 'top', 'bottom'] as const;
export type EdgeZone = (typeof edgeZones)[number];

const EDGE_DROP_BAND = 0.1;

export function tabDropZone(x: number, y: number): EdgeZone | null {
  if (x > EDGE_DROP_BAND && x < 1 - EDGE_DROP_BAND && y > EDGE_DROP_BAND && y < 1 - EDGE_DROP_BAND)
    return null;
  if (x < 1 / 3) return 'left';
  if (x > 2 / 3) return 'right';
  return y < 0.5 ? 'top' : 'bottom';
}

let currentTabDrag: TabDragPayload | null = null;

export function setCurrentTabDrag(payload: TabDragPayload | null): void {
  currentTabDrag = payload;
}

export function getCurrentTabDrag(): TabDragPayload | null {
  return currentTabDrag;
}
