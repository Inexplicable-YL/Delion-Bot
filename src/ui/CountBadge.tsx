import { cn } from './cn';

function CountBadge({ count, className }: { count: number; className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex h-badge min-w-badge items-center justify-center rounded-full bg-fill px-1.5 text-ui-caption tabular-nums text-ink-2',
        className,
      )}
      data-slot="count-badge"
    >
      {count > 99 ? '99+' : count}
    </span>
  );
}

export { CountBadge };
