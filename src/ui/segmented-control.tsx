'use client';

import type { OutlineIcon } from './outline-icon';

export function SegmentedControl<T extends string>({
  options,
  labels,
  icons,
  value,
  onChange,
  className = '',
  'aria-label': label,
}: {
  options: readonly T[];
  labels?: Readonly<Record<T, string>>;
  icons?: Readonly<Partial<Record<T, OutlineIcon>>>;
  value: T | null;
  onChange: (v: T) => void;
  className?: string;
  'aria-label'?: string;
}) {
  const index = value === null ? -1 : options.indexOf(value);
  return (
    <div
      className={`relative inline-grid select-none rounded-full glass p-1 ${className}`}
      style={{ gridTemplateColumns: `repeat(${options.length}, 1fr)` }}
      role="group"
      aria-label={label}
      onKeyDown={(event) => {
        if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
        const buttons = Array.from(event.currentTarget.querySelectorAll('button'));
        const current = buttons.findIndex((button) => button === event.target);
        if (current === -1) return;
        event.preventDefault();
        const direction = event.key === 'ArrowRight' ? 1 : -1;
        const next = (current + direction + options.length) % options.length;
        buttons[next]?.focus();
        const option = options[next];
        if (option !== undefined) onChange(option);
      }}
    >
      <span
        aria-hidden
        className={`absolute inset-y-1 rounded-full bg-surface shadow-hairline
          transition-transform duration-fast ease-spring ${index === -1 ? 'hidden' : ''}`}
        style={{
          width: `calc((100% - var(--spacing) * 2) / ${options.length})`,
          left: 'var(--spacing)',
          transform: `translateX(${index * 100}%)`,
        }}
      />
      {options.map((opt) => {
        const Icon: OutlineIcon | undefined = icons?.[opt];
        return (
          <button
            key={opt}
            aria-pressed={opt === value}
            onClick={() => onChange(opt)}
            type="button"
            className={`relative z-10 inline-flex items-center justify-center gap-1.5 min-h-control-xs touch:min-h-control-lg rounded-full px-3 text-ui-button
            transition-colors duration-base
            ${opt === value ? 'text-ink' : 'text-ink-2 hover:text-ink'}`}
          >
            {Icon && <Icon aria-hidden="true" className="size-4 shrink-0" />}
            {labels?.[opt] ?? opt}
          </button>
        );
      })}
    </div>
  );
}
