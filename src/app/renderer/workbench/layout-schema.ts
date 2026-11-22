import {
  ratioMax,
  ratioMin,
  workbenchLayoutSchema,
  type GroupNode,
  type LayoutNode,
  type TabId,
  type WorkbenchLayout,
} from '../../../modules/workspace/contract';

export type {
  GroupNode,
  LayoutNode,
  SplitNode,
  SplitOrientation,
  TabId,
  TabKind,
  WorkbenchLayout,
} from '../../../modules/workspace/contract';
export {
  maxLayoutNodes,
  maxTabsPerGroup,
  ratioMax,
  ratioMin,
} from '../../../modules/workspace/contract';

function normalizeGroup(group: GroupNode, keepTab?: (tab: TabId) => boolean): GroupNode {
  const tabs = group.tabs.filter(
    (tab) => !/^review:[0-9a-f-]{36}:uncommitted$/.test(tab) && (keepTab?.(tab) ?? true),
  );
  const pinned = [...new Set(group.pinned ?? [])].filter((tab) => tabs.includes(tab));
  const preview =
    group.preview && tabs.includes(group.preview) && !pinned.includes(group.preview)
      ? group.preview
      : undefined;
  return {
    ...group,
    tabs: [...pinned, ...tabs.filter((tab) => !pinned.includes(tab))],
    active: group.active && !tabs.includes(group.active) ? (tabs[0] ?? null) : group.active,
    pinned: pinned.length ? pinned : undefined,
    preview,
  };
}

export function parseWorkbenchLayout(
  value: unknown,
  keepTab?: (tab: TabId) => boolean,
): WorkbenchLayout | null {
  const parsed = workbenchLayoutSchema.safeParse(value);
  if (!parsed.success) return null;
  let root = parsed.data.root;
  for (const group of walkGroups(root))
    root = updateGroup(root, group.id, (current) => normalizeGroup(current, keepTab));
  return { ...parsed.data, root };
}

export function clampRatio(ratio: number): number {
  return Number.isFinite(ratio) ? Math.min(ratioMax, Math.max(ratioMin, ratio)) : 0.5;
}

export function countNodes(node: LayoutNode): number {
  return node.type === 'group'
    ? 1
    : 1 + node.children.reduce((sum, child) => sum + countNodes(child), 0);
}

export function splitDepth(node: LayoutNode): number {
  return node.type === 'group' ? 0 : 1 + Math.max(...node.children.map(splitDepth));
}

export function walkGroups(node: LayoutNode): GroupNode[] {
  return node.type === 'group' ? [node] : node.children.flatMap(walkGroups);
}

export function findGroup(node: LayoutNode, id: string): GroupNode | null {
  return walkGroups(node).find((group) => group.id === id) ?? null;
}

export function nextGroupId(root: LayoutNode): string {
  const used = new Set(walkGroups(root).map((group) => group.id));
  let n = 1;
  while (used.has(`g${n}`)) n += 1;
  return `g${n}`;
}

export function updateGroup(
  node: LayoutNode,
  id: string,
  update: (group: GroupNode) => GroupNode,
): LayoutNode {
  return replaceGroupNode(node, id, (group) => update(group));
}

export function replaceGroupNode(
  node: LayoutNode,
  id: string,
  next: (group: GroupNode) => LayoutNode,
): LayoutNode {
  if (node.type === 'group') return node.id === id ? next(node) : node;
  return { ...node, children: node.children.map((child) => replaceGroupNode(child, id, next)) };
}

export function removeGroup(node: LayoutNode, id: string): LayoutNode {
  if (node.type === 'group') return node;
  const remaining = node.children
    .filter((child) => !(child.type === 'group' && child.id === id))
    .map((child) => removeGroup(child, id));
  if (remaining.length === 1) return remaining[0]!;
  return { ...node, children: remaining };
}

export function nodeAtPath(root: LayoutNode, path: readonly number[]): LayoutNode | null {
  let node: LayoutNode | null = root;
  for (const index of path) {
    if (!node || node.type !== 'split') return null;
    node = node.children[index] ?? null;
  }
  return node;
}

export function replaceAtPath(
  node: LayoutNode,
  path: readonly number[],
  next: LayoutNode,
): LayoutNode {
  if (!path.length) return next;
  if (node.type !== 'split') return node;
  const head = path[0];
  if (head === undefined) return node;
  const rest = path.slice(1);
  const child = node.children[head];
  if (child === undefined) return node;
  const children = [...node.children];
  children[head] = replaceAtPath(child, rest, next);
  return { ...node, children };
}

export function createDefaultLayout(): WorkbenchLayout {
  const root: GroupNode = { type: 'group', id: 'primary', tabs: [], active: null };
  return { root, focus: 'primary', maximized: null };
}

export function collapseEmptyGroups(layout: WorkbenchLayout): WorkbenchLayout {
  const prune = (node: LayoutNode): LayoutNode | null => {
    if (node.type === 'group') return node.tabs.length ? node : null;
    const children = node.children
      .map(prune)
      .filter((child): child is LayoutNode => child !== null);
    if (!children.length) return null;
    if (children.length === 1) return children[0]!;
    return { ...node, children };
  };
  const root = prune(layout.root) ?? walkGroups(layout.root)[0] ?? createDefaultLayout().root;
  const groups = walkGroups(root);
  return {
    root,
    focus: groups.some((group) => group.id === layout.focus) ? layout.focus : groups[0]!.id,
    maximized: groups.some((group) => group.id === layout.maximized) ? layout.maximized : null,
  };
}
