import { Slot } from 'radix-ui';
import { useId } from 'react';
import type * as React from 'react';
import { ErrorText } from './Alert';
import { cn } from './cn';

type FieldProps = Omit<React.ComponentProps<'label'>, 'children'> & {
  label: React.ReactNode;
  hint?: React.ReactNode;
  error?: React.ReactNode;
  children: React.ReactNode;
};

function Field({ label, hint, error, children, className, ...props }: FieldProps) {
  const errorId = useId();
  return (
    <label className={cn('grid gap-2 text-ui-body', className)} data-slot="field" {...props}>
      {label}
      {error ? (
        <Slot.Root aria-describedby={errorId} aria-invalid>
          {children}
        </Slot.Root>
      ) : (
        children
      )}
      {hint ? <span className="text-ui-subhead text-ink-2">{hint}</span> : null}
      {error ? <ErrorText id={errorId}>{error}</ErrorText> : null}
    </label>
  );
}

export { Field };
