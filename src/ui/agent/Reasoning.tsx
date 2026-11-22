import type { ReactNode } from 'react';
import { cn } from '../cn';
import { Shimmer } from '../Shimmer';
import { TraceDisclosure } from './Trace';

export function Reasoning({
  streaming,
  label,
  children,
}: {
  streaming: boolean;
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="my-1">
      <TraceDisclosure head={streaming ? <Shimmer>Thinking</Shimmer> : <span>{label}</span>}>
        <div
          data-reasoning-body
          className={cn(
            'overflow-y-auto text-ui-body whitespace-pre-wrap text-ink-2',
            streaming ? 'flex max-h-40 flex-col-reverse' : 'max-h-72',
          )}
        >
          <div>{children}</div>
        </div>
      </TraceDisclosure>
    </div>
  );
}
