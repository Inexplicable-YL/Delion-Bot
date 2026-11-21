import { cn } from '../../../ui/cn';

export const rowEndInset = 'pr-0.5';

export const navRow = (active: boolean) =>
  cn(
    'flex min-h-row-compact touch:min-h-row-regular min-w-0 items-center gap-2.5 rounded-control px-2 text-left text-ui-button',
    active ? 'bg-selected font-medium text-ink' : 'text-ink-2 hover:bg-hover hover:text-ink',
  );

export const navIcon = (active: boolean) =>
  cn('size-5 shrink-0', active ? 'text-accent-ink' : 'text-ink-2');

export const navSubRow = (active: boolean, nested: boolean) =>
  cn(
    'group relative flex min-h-row-compact touch:min-h-row-regular min-w-0 items-center rounded-control transition-colors duration-base',
    rowEndInset,
    nested ? 'pl-8' : 'pl-2',
    active ? 'bg-selected text-ink' : 'text-ink-3 hover:bg-hover hover:text-ink-2',
  );

export const navSectionTitle = 'px-2 pb-1 text-ui-subhead text-ink-3';

export const rowActions =
  'hidden shrink-0 items-center gap-0.5 group-hover:flex group-focus-within:flex has-[[data-state=open]]:flex max-md:flex touch:flex';

export const rowStatus =
  'group-hover:hidden group-focus-within:hidden group-has-[[data-state=open]]:hidden max-md:hidden touch:hidden';
