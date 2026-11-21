import { useState } from 'react';
import { CheckIcon as Check, XMarkIcon as X } from '@heroicons/react/24/outline';
import { Button } from '../../../ui/Button';
import { cn } from '../../../ui/cn';
import { Collapse, CollapseChevron } from '../../../ui/Collapse';
import type { RemoteSetupProgress, RemoteSetupStep } from '../contract';
import { Spinner } from '../../../ui/Spinner';

const stepLabels: Record<RemoteSetupStep, string> = {
  probe: '探测',
  verify: '校验',
  upload: '上传',
  start: '启动',
  tunnel: '隧道',
  handshake: '握手',
  ready: '就绪',
};

const visibleSteps: RemoteSetupStep[] = [
  'probe',
  'verify',
  'upload',
  'start',
  'tunnel',
  'handshake',
];

type StepStatus = 'pending' | 'running' | 'done' | 'failed' | 'skipped';

function statusOf(log: RemoteSetupProgress[], step: RemoteSetupStep, done: boolean): StepStatus {
  const lines = log.filter((line) => line.step === step);
  if (lines.some((line) => line.ok === false)) return 'failed';
  if (lines.some((line) => line.ok === true)) return 'done';
  if (lines.length) return 'running';
  const index = visibleSteps.indexOf(step);
  const later = visibleSteps
    .slice(index + 1)
    .some((next) => log.some((line) => line.step === next));
  return later || done ? 'skipped' : 'pending';
}

function formatBytes(bytes: number): string {
  return bytes >= 1024 * 1024
    ? `${(bytes / 1024 / 1024).toFixed(1)} MB`
    : `${Math.round(bytes / 1024)} KB`;
}

function failureTitle(step: RemoteSetupStep | undefined): string {
  switch (step) {
    case 'probe':
      return '无法通过 SSH 连上这台服务器';
    case 'verify':
    case 'upload':
      return '无法把 helper 放到服务器上';
    case 'start':
      return '无法在这台服务器上启动 helper';
    case 'tunnel':
    case 'handshake':
      return '无法与服务器上的 helper 建立通道';
    default:
      return '连接失败';
  }
}

const stickToBottom = (anchor: HTMLElement | null) => {
  if (anchor?.parentElement) anchor.parentElement.scrollTop = anchor.parentElement.scrollHeight;
};

export function SetupProgress({
  log,
  running,
  failure,
  onRetry,
  onEdit,
}: {
  log: RemoteSetupProgress[];
  running: boolean;
  failure: string | null;
  onRetry: () => void;
  onEdit?: () => void;
}) {
  const [expanded, setExpanded] = useState(true);
  const done = !running;
  const failedLine = log.findLast((line) => line.ok === false);
  const upload = log.findLast((line) => line.step === 'upload' && line.bytes);
  const uploading = upload?.bytes && upload.ok === undefined && running;
  const lines = log.filter((line) => !(line.step === 'upload' && line.bytes && !line.detail));

  return (
    <div className="grid gap-3 rounded-card border border-line bg-field p-3.5">
      {failure ? (
        <div className="grid gap-1" role="alert">
          <p className="flex items-center gap-1.5 text-ui-headline text-danger">
            <X className="size-4 shrink-0" />
            {failureTitle(failedLine?.step)}
          </p>
          <p className="pl-5.5 text-ui-subhead wrap-anywhere text-ink-2">{failure}</p>
          <div className="flex gap-2 pt-1.5 pl-5.5">
            <Button onClick={onRetry} size="sm" type="button" variant="secondary">
              重试
            </Button>
            {onEdit && (
              <Button onClick={onEdit} size="sm" type="button" variant="ghost">
                编辑连接
              </Button>
            )}
          </div>
        </div>
      ) : (
        <p className="flex items-center gap-1.5 text-ui-headline text-ink" role="status">
          {running ? (
            <Spinner className="shrink-0 text-ink-2" />
          ) : (
            <Check className="size-4 shrink-0 text-success" />
          )}
          {running
            ? log.some((line) => line.step === 'upload')
              ? '正在准备远端环境（仅首次）'
              : '正在连接…'
            : '已连接'}
        </p>
      )}

      <ol className="flex flex-wrap gap-x-3 gap-y-1 text-ui-subhead">
        {visibleSteps.map((step) => {
          const status = statusOf(log, step, done && !failure);
          if (status === 'skipped' && step === 'upload') return null;
          return (
            <li
              className={cn(
                'flex items-center gap-1',
                status === 'pending' && 'text-ink-2',
                status === 'running' && 'font-medium text-ink',
                status === 'done' && 'text-ink-2',
                status === 'skipped' && 'text-ink-2',
                status === 'failed' && 'font-medium text-danger',
              )}
              key={step}
            >
              {status === 'done' || status === 'skipped' ? (
                <Check className="size-4 text-success" aria-hidden="true" />
              ) : status === 'failed' ? (
                <X className="size-4" aria-hidden="true" />
              ) : status === 'running' ? (
                <span
                  aria-hidden="true"
                  className="size-1.5 animate-pulse rounded-full bg-warning motion-reduce:animate-none"
                />
              ) : (
                <span
                  aria-hidden="true"
                  className="size-1.5 rounded-full border border-line-strong"
                />
              )}
              {stepLabels[step]}
            </li>
          );
        })}
      </ol>

      {uploading && upload.bytes && (
        <div className="grid gap-1">
          <div
            aria-label="上传 helper"
            aria-valuemax={upload.bytes.total}
            aria-valuemin={0}
            aria-valuenow={upload.bytes.sent}
            className="h-1.5 overflow-hidden rounded-full bg-line"
            role="progressbar"
          >
            <div
              className="h-full rounded-full bg-ink-2 "
              style={{ width: `${(upload.bytes.sent / upload.bytes.total) * 100}%` }}
            />
          </div>
          <p className="text-right text-ui-subhead tabular-nums text-ink-2">
            {formatBytes(upload.bytes.sent)} / {formatBytes(upload.bytes.total)}
          </p>
        </div>
      )}

      <div className="grid gap-1.5">
        <button
          aria-expanded={expanded}
          className="flex w-fit items-center gap-1 text-ui-subhead text-ink-2 transition-colors duration-base hover:text-ink-2"
          onClick={() => setExpanded((value) => !value)}
          type="button"
        >
          <CollapseChevron open={expanded} />
          详细日志
        </button>
        <Collapse open={expanded}>
          <div
            className="grid max-h-36 content-start gap-0.5 overflow-y-auto rounded-control bg-surface px-2.5 py-2 font-mono text-ui-subhead"
            role="log"
          >
            {lines.length === 0 ? (
              <p className="text-ink-2">等待服务器响应…</p>
            ) : (
              lines.map((line, index) => (
                <p
                  className={cn('flex min-w-0 gap-2', line.ok === false && 'text-danger')}
                  key={`${index}-${line.step}`}
                >
                  <span className="w-7 shrink-0 text-ink-2">{stepLabels[line.step]}</span>
                  <span className="min-w-0 wrap-anywhere text-ink-2">
                    {line.ok === false ? '✕ ' : line.ok ? '✓ ' : ''}
                    {line.detail}
                    {line.bytes && line.detail ? ` · ${formatBytes(line.bytes.total)}` : ''}
                  </span>
                </p>
              ))
            )}
            <span aria-hidden="true" className="absolute" key={lines.length} ref={stickToBottom} />
          </div>
        </Collapse>
      </div>
    </div>
  );
}
