import { cn } from '../../../ui/cn';

export const navRow = (active: boolean) =>
  cn(
    'flex min-h-row-compact touch:min-h-row-regular min-w-0 items-center gap-2.5 rounded-control px-2 text-left text-ui-button',
    active ? 'bg-selected font-medium text-ink' : 'text-ink-2 hover:bg-hover hover:text-ink',
  );

export const navIcon = (active: boolean) =>
  cn('size-5 shrink-0', active ? 'text-accent-ink' : 'text-ink-2');

export const navSubRow = (active: boolean) =>
  cn(
    'group relative flex min-h-control-xs touch:min-h-row-regular min-w-0 items-center rounded-control pl-8 pr-1.5 transition-colors duration-base',
    active ? 'bg-selected text-ink' : 'text-ink-3 hover:bg-hover hover:text-ink-2',
  );

export const navSectionTitle = 'px-2 pb-1 text-ui-subhead text-ink-3';

// 行内操作平时不占位，标题可用整行宽度；悬停、聚焦或菜单打开时才挤进行尾。
export const rowActions =
  'hidden shrink-0 items-center gap-0.5 group-hover:flex group-focus-within:flex has-[[data-state=open]]:flex max-md:flex touch:flex';

/** 行尾状态标记：与行内操作互斥，操作出现时让位。 */
export const rowStatus =
  'group-hover:hidden group-focus-within:hidden group-has-[[data-state=open]]:hidden max-md:hidden touch:hidden';
