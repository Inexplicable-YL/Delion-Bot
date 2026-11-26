import { ChevronRightIcon as ChevronRight } from '@heroicons/react/24/outline';
import { useState, type ReactNode } from 'react';
import { cn } from './cn';
import { useMediaQuery } from './use-media-query';

function Collapse({
  open,
  className,
  children,
}: {
  open: boolean;
  className?: string;
  children: ReactNode;
}) {
  const reducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)');
  const [closing, setClosing] = useState(false);
  const [wasOpen, setWasOpen] = useState(open);
  if (wasOpen !== open) {
    setWasOpen(open);
    setClosing(!open && !reducedMotion);
  }
  return (
    <div
      className={cn(
        'grid transition-[grid-template-rows,opacity] duration-slow ease-out-strong motion-reduce:transition-none',
        open ? 'grid-rows-[1fr]' : 'grid-rows-[0fr] opacity-0',
      )}
      data-slot="collapse"
      data-state={open ? 'open' : 'closed'}
      inert={!open}
      onTransitionEnd={(event) => {
        if (event.target === event.currentTarget && event.propertyName === 'grid-template-rows')
          setClosing(false);
      }}
    >
      <div className={cn('min-h-0 overflow-hidden', className)}>
        {(open || closing) && children}
      </div>
    </div>
  );
}

function CollapseChevron({ open, className }: { open: boolean; className?: string }) {
  return (
    <ChevronRight
      aria-hidden="true"
      className={cn(
        'size-4 shrink-0 transition-transform duration-base motion-reduce:transition-none',
        open && 'rotate-90',
        className,
      )}
    />
  );
}

function CollapsibleSection({
  action,
  children,
  onOpenChange,
  open,
  title,
}: {
  action?: ReactNode;
  children: ReactNode;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  title: ReactNode;
}) {
  const [toggled, setToggled] = useState(false);
  return (
    <details
      open={open}
      onToggle={(event) => {
        if (toggled && event.currentTarget.open) {
          event.currentTarget.scrollIntoView({ block: 'nearest' });
        }
      }}
    >
      <summary
        className="flex cursor-pointer list-none items-center justify-between gap-4 rounded-control focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-ink"
        onClick={(event) => {
          event.preventDefault();
          setToggled(true);
          onOpenChange(!open);
        }}
      >
        <h2 className="flex items-center gap-2 text-ui-title-3 text-ink">
          <CollapseChevron className="text-ink-2" open={open} />
          {title}
        </h2>
        {action && <span onClick={(event) => event.stopPropagation()}>{action}</span>}
      </summary>
      {children}
    </details>
  );
}

export { Collapse, CollapseChevron, CollapsibleSection };
