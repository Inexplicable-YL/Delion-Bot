import type * as React from 'react';
import { cn } from './cn';

const inputVariants = {
  default:
    'bg-field shadow-hairline hover:shadow-hairline-strong focus-visible:bg-surface focus-visible:shadow-focus',
  ghost: '',
} as const;

const inputSizes = {
  default: '',
  lg: 'h-control-md rounded-control px-3',
} as const;

function Input({
  className,
  type,
  variant = 'default',
  size = 'default',
  ...props
}: Omit<React.ComponentProps<'input'>, 'size'> & {
  variant?: keyof typeof inputVariants;
  size?: keyof typeof inputSizes;
}) {
  return (
    <input
      className={cn(
        'h-control-sm touch:h-control-lg touch:text-ui-input-touch py-1 file:inline-flex file:h-6 file:border-0 file:bg-transparent file:text-ui-body  file:text-ink',
        'placeholder:text-ink-2 selection:bg-accent-tint flex w-full min-w-0 rounded-control bg-transparent px-2.5 text-ui-body text-ink transition-[background-color,box-shadow] duration-base disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50',
        'aria-invalid:shadow-invalid',
        inputVariants[variant],
        inputSizes[size],
        className,
      )}
      data-slot="input"
      type={type}
      {...props}
    />
  );
}

export { Input };
