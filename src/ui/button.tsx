import { Slot } from 'radix-ui';
import { cva, type VariantProps } from 'class-variance-authority';
import type * as React from 'react';
import { cn } from './cn';

const buttonVariants = cva(
  "inline-flex shrink-0 select-none items-center justify-center gap-1.5 whitespace-nowrap rounded-full text-ui-button transition-[scale,opacity] duration-press ease-spring active:scale-(--press-scale) disabled:pointer-events-none disabled:opacity-50 touch:min-h-control-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-ink [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: 'bg-ink text-canvas hover:opacity-90',
        accent: 'bg-accent-fill text-on-accent hover:brightness-95',
        destructive: 'bg-danger text-on-danger hover:brightness-95',
        outline: 'text-ink shadow-btn hover:bg-hover aria-expanded:bg-selected',
        secondary: 'text-ink shadow-btn hover:bg-hover',
        ghost: 'text-ink-2 hover:bg-hover hover:text-ink aria-expanded:bg-hover',
        glass:
          'glass text-ink-2 hover:brightness-105 hover:text-ink aria-[current=page]:text-accent-ink',
        link: 'text-accent-ink underline-offset-4 hover:underline active:scale-100',
      },
      size: {
        default: 'h-control-sm px-3 has-[>svg]:px-2.5',
        sm: 'h-control-xs px-2.5 has-[>svg]:px-2',
        lg: 'h-control-lg px-4 has-[>svg]:px-3',
        icon: 'size-control-sm touch:min-w-control-lg',
        'icon-lg': "size-control-md touch:min-w-control-lg [&_svg:not([class*='size-'])]:size-5",
        'icon-sm': 'size-control-xs touch:min-w-control-lg',
        'icon-xs': "size-control-xs touch:min-w-control-lg [&_svg:not([class*='size-'])]:size-4",
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
);

type ButtonProps = React.ComponentProps<'button'> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
  };

function Button({ className, variant, size, asChild = false, type, ...props }: ButtonProps) {
  const Comp = asChild ? Slot.Root : 'button';
  return (
    <Comp
      className={cn(buttonVariants({ variant, size, className }))}
      data-slot="button"
      type={type ?? 'button'}
      {...props}
    />
  );
}

export { Button };
