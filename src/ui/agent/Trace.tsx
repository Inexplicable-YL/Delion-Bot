'use client';

import { Fragment, useState, type ReactNode } from 'react';
import { cn } from '../cn';
import { Collapse, CollapseChevron } from '../Collapse';
import { fadeIn } from '../motion';
import { Shimmer } from '../Shimmer';
import { useNow } from '../use-now';
import { ThinkingMark } from './ThinkingMark';

const toggleClass =
  'group/row flex h-7 w-full min-w-0 items-center gap-2 text-left text-ui-body text-ink-2 transition-colors duration-base hover:text-ink focus-visible:outline-none focus-visible:text-ink aria-expanded:text-ink';

const nestedClass = 'ml-1.75 border-l border-line pl-4';

const chevronClass = 'opacity-0 group-hover/row:opacity-100 group-focus-visible/row:opacity-100';

export function TraceDisclosure({
  head,
  icon,
  defaultOpen = false,
  children,
}: {
  head: ReactNode;
  icon?: ReactNode;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [toggled, setToggled] = useState<boolean | null>(null);
  const open = toggled ?? defaultOpen;
  return (
    <div className="min-w-0">
      <button
        type="button"
        aria-expanded={open}
        data-trace-toggle
        onClick={() => setToggled(!open)}
        className={toggleClass}
      >
        {icon && (
          <span aria-hidden="true" className="grid size-4 shrink-0 place-items-center">
            {icon}
          </span>
        )}
        <span className="flex min-w-0 items-center gap-1">{head}</span>
        <CollapseChevron className={chevronClass} open={open} />
      </button>
      <Collapse className={nestedClass} open={open}>
        <div className="min-w-0 pb-2">{children}</div>
      </Collapse>
    </div>
  );
}

export type TraceRunning = {
  current: ReactNode;
  startedAt: number;
  keepLast: boolean;
  formatElapsed: (ms: number) => string;
};

function RunningElapsed({ running }: { running: TraceRunning }) {
  const now = useNow(1000);
  return <>处理中 {running.formatElapsed(Math.max(0, now - running.startedAt))}</>;
}

export function Trace({
  blocks,
  foldLabel,
  running,
}: {
  blocks: { key: number; node: ReactNode }[];
  foldLabel?: string;
  running?: TraceRunning;
}) {
  const [expanded, setExpanded] = useState(false);
  const lastIndex = blocks.length - 1;
  const waiting = blocks.length === 0;
  const folded = running
    ? running.keepLast
      ? lastIndex
      : blocks.length
    : foldLabel !== undefined
      ? lastIndex
      : 0;
  return (
    <div aria-label="对话过程" className="min-w-0">
      {running && (folded > 0 || waiting) && (
        <button
          type="button"
          aria-expanded={waiting ? undefined : expanded}
          data-trace-toggle
          disabled={waiting}
          onClick={() => setExpanded(!expanded)}
          className={cn(toggleClass, 'mb-1 w-auto max-w-full disabled:pointer-events-none')}
        >
          <span aria-hidden="true" className="grid size-4 shrink-0 place-items-center">
            <ThinkingMark />
          </span>
          <Shimmer className="min-w-0 truncate">
            {expanded && !waiting ? <RunningElapsed running={running} /> : running.current}
          </Shimmer>
          {!waiting && <CollapseChevron className={cn('-ml-1', chevronClass)} open={expanded} />}
        </button>
      )}
      {!running && foldLabel !== undefined && (
        <button
          type="button"
          aria-expanded={expanded}
          data-trace-toggle
          onClick={() => setExpanded(!expanded)}
          className={cn(toggleClass, 'mb-1 w-auto max-w-full gap-1')}
        >
          <span className="min-w-0 truncate">{foldLabel}</span>
          <CollapseChevron className={chevronClass} open={expanded} />
        </button>
      )}
      {folded > 0 && (
        <div hidden={!expanded} className={cn(fadeIn, 'flow-root', running && nestedClass)}>
          {blocks.slice(0, folded).map(({ key, node }) => (
            <Fragment key={key}>{node}</Fragment>
          ))}
        </div>
      )}
      {blocks.slice(folded).map(({ key, node }) => (
        <Fragment key={key}>{node}</Fragment>
      ))}
    </div>
  );
}
