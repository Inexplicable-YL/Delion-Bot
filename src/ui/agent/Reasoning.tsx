import type { ReactNode } from 'react';
import { Shimmer } from '../Shimmer';
import { TraceDisclosure } from './Trace';

export function Reasoning({ live, children }: { live: boolean; children: ReactNode }) {
  return (
    <div className="my-1">
      <TraceDisclosure head={live ? <Shimmer>正在思考</Shimmer> : <span>思考过程</span>}>
        <div
          data-reasoning-body
          className="max-h-72 overflow-y-auto border-l border-line pl-3 text-ui-body whitespace-pre-wrap text-ink-2"
        >
          {children}
        </div>
      </TraceDisclosure>
    </div>
  );
}
