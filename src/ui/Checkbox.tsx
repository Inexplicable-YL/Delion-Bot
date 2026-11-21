import type * as React from 'react';
import { cn } from './cn';

function Checkbox({ className, ...props }: Omit<React.ComponentProps<'input'>, 'type'>) {
  return (
    <input
      className={cn('size-4 shrink-0 accent-accent-fill', className)}
      data-slot="checkbox"
      type="checkbox"
      {...props}
    />
  );
}

export { Checkbox };
