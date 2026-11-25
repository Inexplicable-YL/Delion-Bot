import {
  ArrowPathIcon as RefreshCw,
  CodeBracketIcon as Code,
  FolderOpenIcon as FolderOpen,
  MagnifyingGlassMinusIcon as ZoomOut,
  MagnifyingGlassPlusIcon as ZoomIn,
} from '@heroicons/react/24/outline';
import type { ComponentProps, ReactNode } from 'react';
import { cn } from './cn';
import { FileIcon } from './FileIcon';
import { FitWidthIcon } from './FitWidthIcon';
import { IconButton } from './IconButton';
import { Spinner } from './Spinner';

export type DocumentMode = 'live' | 'source';

export function DocumentToolbarButton({
  label,
  className,
  ...props
}: ComponentProps<typeof IconButton> & { label: string }) {
  return (
    <IconButton
      size="sm"
      title={label}
      aria-label={label}
      className={cn('rounded-pill', className)}
      {...props}
    />
  );
}

export function DocumentToolbarDivider() {
  return <span aria-hidden className="mx-1 h-4 w-px shrink-0 bg-line-strong" />;
}

export function DocumentZoomControls({
  zoom,
  disabled,
  zoomOutLabel = '缩小',
  zoomInLabel = '放大',
  onZoomOut,
  onZoomIn,
  onReset,
  onFit,
}: {
  zoom: number;
  disabled?: boolean;
  zoomOutLabel?: string;
  zoomInLabel?: string;
  onZoomOut: () => void;
  onZoomIn: () => void;
  onReset: () => void;
  onFit?: () => void;
}) {
  return (
    <>
      <DocumentToolbarButton label={zoomOutLabel} disabled={disabled} onClick={onZoomOut}>
        <ZoomOut />
      </DocumentToolbarButton>
      <button
        type="button"
        title="重置缩放到 100%"
        aria-label="重置缩放到 100%"
        disabled={disabled}
        className="h-control-xs min-w-12 rounded-pill px-1.5 text-center tabular-nums text-ink-2 transition-colors duration-fast hover:bg-hover hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-ink disabled:opacity-50"
        onClick={onReset}
      >
        {Math.round(zoom * 100)}%
      </button>
      <DocumentToolbarButton label={zoomInLabel} disabled={disabled} onClick={onZoomIn}>
        <ZoomIn />
      </DocumentToolbarButton>
      {onFit && (
        <>
          <DocumentToolbarDivider />
          <DocumentToolbarButton label="适合宽度" disabled={disabled} onClick={onFit}>
            <FitWidthIcon />
          </DocumentToolbarButton>
        </>
      )}
    </>
  );
}

export function DocumentToolbar({
  path,
  mode = 'live',
  onModeChange,
  previewLabel = '返回即时渲染',
  saving,
  dirty,
  failed,
  onOpenInFolder,
  onReload,
  controls,
  actions,
}: {
  path: string[];
  mode?: DocumentMode;
  onModeChange?: (mode: DocumentMode) => void;
  previewLabel?: string;
  saving?: boolean;
  dirty?: boolean;
  failed?: boolean;
  onOpenInFolder?: () => void;
  onReload: () => void;
  controls?: ReactNode;
  actions?: ReactNode;
}) {
  const name = path.at(-1) ?? '';
  const source = mode === 'source';
  return (
    <div
      className="flex min-h-row-regular min-w-0 shrink-0 items-center gap-3 px-3 text-ui-callout"
      role="toolbar"
      aria-label="文件操作"
    >
      <nav
        aria-label="文件路径"
        className="flex min-w-0 flex-1 items-center gap-2"
        title={path.join(' / ')}
      >
        <FileIcon path={name} className="size-4 shrink-0 text-ink-2" />
        <ol className="flex min-w-0 items-center gap-1.5">
          {path.map((segment, index) => {
            const last = index === path.length - 1;
            return (
              <li
                key={index}
                className={cn(
                  'flex min-w-0 items-center gap-1.5',
                  last ? 'shrink-0 basis-auto' : 'shrink',
                )}
              >
                {index > 0 && (
                  <span aria-hidden className="shrink-0 text-ink-4">
                    /
                  </span>
                )}
                <span
                  className={cn('truncate', last ? 'max-w-full text-ink' : 'text-ink-2')}
                  aria-current={last ? 'page' : undefined}
                >
                  {segment}
                </span>
              </li>
            );
          })}
        </ol>
      </nav>
      <span
        className={cn('flex shrink-0 items-center gap-1.5 text-ink-2', failed && 'text-danger')}
        role="status"
        aria-live="polite"
      >
        {saving ? (
          <>
            <Spinner size="xs" />
            保存中…
          </>
        ) : dirty ? (
          <>
            <span aria-hidden className="size-1.5 rounded-pill bg-current" />
            未保存
          </>
        ) : null}
      </span>
      {controls && (
        <div className="flex shrink-0 items-center gap-0.5 rounded-pill bg-field p-0.5">
          {controls}
        </div>
      )}
      <div className="flex shrink-0 items-center gap-0.5">
        {onModeChange && (
          <DocumentToolbarButton
            label={source ? previewLabel : '源码模式'}
            aria-pressed={source}
            onClick={() => onModeChange(source ? 'live' : 'source')}
          >
            <Code />
          </DocumentToolbarButton>
        )}
        {onOpenInFolder && (
          <DocumentToolbarButton label="在文件夹中显示" onClick={onOpenInFolder}>
            <FolderOpen />
          </DocumentToolbarButton>
        )}
        <DocumentToolbarButton label="重新载入" onClick={onReload}>
          <RefreshCw />
        </DocumentToolbarButton>
        {actions && (
          <>
            <DocumentToolbarDivider />
            {actions}
          </>
        )}
      </div>
    </div>
  );
}
