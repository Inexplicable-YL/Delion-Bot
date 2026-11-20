import type { ComponentProps } from 'react';
import { cn } from './cn';
import { IconButton } from './icon-button';

export function WindowControlButton({
  close,
  ...props
}: Omit<ComponentProps<typeof IconButton>, 'size' | 'className'> & { close?: boolean }) {
  return (
    <IconButton
      {...props}
      size={null}
      className={cn(
        'size-control-md [&_svg]:size-4',
        close ? 'hover:bg-window-close hover:text-on-accent' : 'hover:bg-hover-strong',
      )}
    />
  );
}
