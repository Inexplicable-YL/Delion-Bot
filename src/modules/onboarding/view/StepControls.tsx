import type { ComponentProps } from 'react';
import { CheckIcon as Check } from '@heroicons/react/24/outline';
import { Button } from '../../../ui/Button';
import { Select, SelectContent, SelectTrigger, SelectValue } from '../../../ui/Select';
import { Spinner } from '../../../ui/Spinner';

export type StepButtonState = 'idle' | 'busy' | 'success';

type StepButtonProps = {
  state: StepButtonState;
  idleLabel: string;
  busyLabel: string;
  successLabel: string;
  disabled?: boolean;
  type?: ComponentProps<typeof Button>['type'];
  onClick?: () => void;
};

export function StepButton({
  state,
  idleLabel,
  busyLabel,
  successLabel,
  disabled,
  type = 'submit',
  onClick,
}: StepButtonProps) {
  return (
    <Button
      className="w-full data-[state=success]:bg-accent"
      data-state={state}
      disabled={disabled || state === 'busy'}
      onClick={onClick}
      size="lg"
      type={type}
    >
      {state === 'busy' && <Spinner />}
      {state === 'success' && <Check aria-hidden="true" />}
      {state === 'idle' ? idleLabel : state === 'busy' ? busyLabel : successLabel}
    </Button>
  );
}

export function StepSelect({
  label,
  children,
  placeholder,
  ...rest
}: ComponentProps<typeof Select> & {
  label: string;
  placeholder?: string;
}) {
  return (
    <Select {...rest}>
      <SelectTrigger aria-label={label} className="w-full" size="lg">
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>{children}</SelectContent>
    </Select>
  );
}
