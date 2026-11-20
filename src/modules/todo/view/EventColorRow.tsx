import type { CalendarEventColor } from '../contract';
import { cn } from '../../../ui/cn';
import { eventPalette } from './calendar';

export function EventColorRow({
  className,
  onColorChange,
  value,
}: {
  className?: string;
  onColorChange: (value: CalendarEventColor) => void;
  value: CalendarEventColor;
}) {
  return (
    <div className={cn('grid gap-1', className)} role="group" aria-label="待办颜色">
      <span className="text-ui-body">颜色</span>
      <div className="flex flex-wrap items-center gap-1">
        {eventPalette.map(({ key, label }) => (
          <button
            aria-label={label}
            aria-pressed={value === key}
            className="grid size-control-xs place-items-center rounded-pill hover:bg-hover touch:size-control-lg"
            key={key}
            onClick={() => onColorChange(key)}
            title={label}
            type="button"
          >
            <span
              aria-hidden="true"
              className={cn(
                'size-5 rounded-pill shadow-hairline',
                value === key && 'ring-2 ring-accent-ink ring-offset-2 ring-offset-surface',
              )}
              style={{ backgroundColor: `var(--cal-${key}-text)` }}
            />
          </button>
        ))}
      </div>
    </div>
  );
}
