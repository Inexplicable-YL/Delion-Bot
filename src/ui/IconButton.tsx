'use client';

import { cva, type VariantProps } from 'class-variance-authority';
import type * as React from 'react';
import { cn } from './cn';

const iconButtonVariants = cva(
  `flex shrink-0 items-center justify-center rounded-control text-ink-2 touch:min-h-control-lg touch:min-w-control-lg
   transition-transform duration-press ease-spring
   hover:bg-hover hover:text-ink active:scale-(--press-scale)
   disabled:pointer-events-none disabled:opacity-50
   aria-pressed:bg-selected aria-pressed:text-ink
   aria-[current=page]:bg-selected aria-[current=page]:text-accent-ink`,
  {
    variants: {
      size: {
        xs: 'size-control-xs [&_svg]:size-4',
        sm: 'size-control-xs [&_svg]:size-4',
        md: 'size-control-sm [&_svg]:size-4',
        lg: 'size-control-md [&_svg]:size-5',
      },
    },
    defaultVariants: { size: 'md' },
  },
);

function IconButton({
  className,
  size,
  type = 'button',
  ...props
}: React.ComponentProps<'button'> & VariantProps<typeof iconButtonVariants>) {
  return (
    <button
      className={cn(iconButtonVariants({ size }), className)}
      data-slot="icon-button"
      data-size={size}
      type={type}
      {...props}
    />
  );
}

export { IconButton };
