import type { ReactNode } from 'react';
import { cn } from '../cn';
import { Shimmer } from '../Shimmer';
import { TraceDisclosure } from './Trace';

export type ToolStepStatus = 'running' | 'done' | 'error' | 'interrupted';

export type ToolStepProps = {
  status: ToolStepStatus;
  icon: ReactNode;
  label: string;
  target?: { text: string; title?: string; mono?: boolean };
  stats?: { added: number; deleted: number };
  progress?: { text: string; title?: string };
  children: ReactNode;
};

export function ToolStep({
  status,
  icon,
  label,
  target,
  stats,
  progress,
  children,
}: ToolStepProps) {
  const running = status === 'running';
  return (
    <TraceDisclosure
      icon={icon}
      head={
        <>
          <span className="shrink-0">
            {running ? <Shimmer>{label}</Shimmer> : <span>{label}</span>}
          </span>
          {target?.text && (
            <span
              className={cn('min-w-0 truncate', target.mono && 'font-mono text-ui-subhead')}
              title={target.title}
            >
              {target.text}
            </span>
          )}
          {stats && (status === 'done' || status === 'interrupted') && (
            <span className="shrink-0 font-mono text-ui-subhead tabular-nums">
              <span className="text-success">+{stats.added}</span>{' '}
              <span className="text-danger">−{stats.deleted}</span>
            </span>
          )}
          {progress && (
            <span className="min-w-0 truncate text-ui-subhead" title={progress.title}>
              {progress.text}
            </span>
          )}
          {status === 'error' && <span className="shrink-0 text-danger">失败</span>}
          {status === 'interrupted' && <span className="shrink-0">未完成</span>}
        </>
      }
    >
      {children}
    </TraceDisclosure>
  );
}

export function ToolGroup({
  summary,
  icon,
  failed = false,
  children,
}: {
  summary?: string;
  icon?: ReactNode;
  failed?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="my-1">
      {summary === undefined ? (
        children
      ) : (
        <TraceDisclosure
          icon={icon}
          head={
            <>
              <span className="min-w-0 truncate">{summary}</span>
              {failed && <span className="shrink-0 text-danger">有失败</span>}
            </>
          }
        >
          {children}
        </TraceDisclosure>
      )}
    </div>
  );
}
