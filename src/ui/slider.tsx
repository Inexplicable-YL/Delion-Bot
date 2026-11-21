'use client';

import { Slider as SliderPrimitive } from 'radix-ui';
import { cn } from './cn';

export function Slider({
  value,
  onValueChange,
  onValueCommit,
  min = 0,
  max = 1,
  step = 0.05,
  labels,
  ariaLabel,
  className,
}: {
  value: number;
  onValueChange: (value: number) => void;
  onValueCommit?: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  labels?: readonly string[];
  ariaLabel?: string;
  className?: string;
}) {
  const stepIndex = Math.round((value - min) / step);
  return (
    <SliderPrimitive.Root
      className={cn(
        'relative flex h-control-sm w-full touch-none select-none items-center touch:min-h-control-lg',
        className,
      )}
      max={max}
      min={min}
      onValueChange={(values) => onValueChange(values[0] ?? min)}
      onValueCommit={(values) => onValueCommit?.(values[0] ?? min)}
      step={step}
      value={[value]}
    >
      <SliderPrimitive.Track className="relative h-4 w-full grow overflow-hidden rounded-full bg-line-strong">
        <SliderPrimitive.Range className="absolute h-full rounded-full bg-accent-fill" />
        {labels && (
          <span
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-2.5 inset-y-0 flex items-center justify-between"
          >
            {labels.map((label, index) => (
              <span
                className={cn(
                  'size-1 rounded-full',
                  index <= stepIndex ? 'bg-on-accent/60' : 'bg-ink-3',
                )}
                key={label}
              />
            ))}
          </span>
        )}
      </SliderPrimitive.Track>
      <SliderPrimitive.Thumb
        aria-label={ariaLabel}
        aria-valuetext={labels?.[stepIndex]}
        className={cn(
          'block size-5 rounded-full bg-on-accent shadow-thumb',
          'outline-none transition-transform duration-press ease-spring active:scale-(--press-scale) motion-reduce:transition-none',
          'focus-visible:ring-2 focus-visible:ring-accent-ink',
        )}
      />
    </SliderPrimitive.Root>
  );
}
