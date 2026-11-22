'use client';

import { Fragment, useState, type ReactNode } from 'react';
import { cn } from '../cn';
import { Collapse, CollapseChevron } from '../Collapse';
import { fadeIn } from '../motion';

const toggleClass =
  'group/row flex h-7 w-full min-w-0 items-center gap-2 text-left text-ui-body text-ink-2 transition-colors duration-base hover:text-ink focus-visible:outline-none focus-visible:text-ink aria-expanded:text-ink';

export function TraceDisclosure({
  head,
  icon,
  forceOpen = false,
  children,
}: {
  head: ReactNode;
  icon?: ReactNode;
  forceOpen?: boolean;
  children: ReactNode;
}) {
  const [userOpen, setOpen] = useState(false);
  const open = forceOpen || userOpen;
  return (
    <div className="min-w-0">
      <button
        type="button"
        aria-expanded={open}
        data-trace-toggle
        onClick={() => setOpen(!open)}
        className={toggleClass}
      >
        {icon && (
          <span aria-hidden="true" className="grid size-4 shrink-0 place-items-center">
            {icon}
          </span>
        )}
        <span className="flex min-w-0 items-center gap-1">{head}</span>
        <CollapseChevron
          className="opacity-0 group-hover/row:opacity-100 group-focus-visible/row:opacity-100 group-aria-expanded/row:opacity-100"
          open={open}
        />
      </button>
      <Collapse className={icon ? 'ml-6' : undefined} open={open}>
        <div className="min-w-0 pb-2">{children}</div>
      </Collapse>
    </div>
  );
}

export function Trace({
  blocks,
  foldLabel,
}: {
  blocks: { key: number; node: ReactNode }[];
  foldLabel?: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const foldable = foldLabel !== undefined;
  const lastIndex = blocks.length - 1;
  return (
    <div aria-label="对话过程" className="min-w-0">
      {foldable && (
        <button
          type="button"
          aria-expanded={expanded}
          data-trace-toggle
          onClick={() => setExpanded(!expanded)}
          className={cn(toggleClass, 'mb-1 w-auto max-w-full gap-1')}
        >
          <span className="min-w-0 truncate">{foldLabel}</span>
          <CollapseChevron open={expanded} />
        </button>
      )}
      {blocks.map(({ key, node }, index) =>
        foldable && index < lastIndex ? (
          <div key={key} hidden={!expanded} className={fadeIn}>
            {node}
          </div>
        ) : (
          <Fragment key={key}>{node}</Fragment>
        ),
      )}
    </div>
  );
}
