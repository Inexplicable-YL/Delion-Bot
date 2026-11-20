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

export const rowActions =
  'pointer-events-none flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity duration-base group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100 has-[[data-state=open]]:pointer-events-auto has-[[data-state=open]]:opacity-100 max-md:pointer-events-auto max-md:opacity-100 touch:pointer-events-auto touch:opacity-100';
