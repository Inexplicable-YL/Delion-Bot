import { Slot } from 'radix-ui';
import { cva, type VariantProps } from 'class-variance-authority';
import type * as React from 'react';
import { cn } from './cn';

const cardVariants = cva('rounded-card bg-surface', {
  variants: {
    variant: {
      outline: 'overflow-hidden shadow-card',
      surface: 'p-card-ui shadow-card',
      inset: 'bg-inset px-4 py-3',
    },
  },
  defaultVariants: { variant: 'outline' },
});

function Card({
  className,
  variant,
  asChild = false,
  ...props
}: React.ComponentProps<'div'> & VariantProps<typeof cardVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : 'div';
  return <Comp className={cn(cardVariants({ variant }), className)} data-slot="card" {...props} />;
}

export { Card };
