export const menuPanel =
  'glass-thick z-popover min-w-32 overflow-x-hidden overflow-y-auto rounded-card p-1 text-ink animate-pop-in';

export const menuItem =
  "relative flex min-h-control-sm touch:min-h-control-lg cursor-default select-none items-center gap-2 rounded-control px-2 text-ui-body text-ink outline-hidden transition-colors duration-fast focus:bg-accent-tint data-[highlighted]:bg-accent-tint data-[disabled]:pointer-events-none data-[disabled]:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 [&_svg:not([class*='text-'])]:text-ink-2";

export const menuItemDestructive =
  'data-[variant=destructive]:text-danger data-[variant=destructive]:focus:bg-danger-tint data-[variant=destructive]:data-[highlighted]:bg-danger-tint data-[variant=destructive]:*:[svg]:!text-danger';
