import {
  ArrowPathIcon as RefreshCw,
  CodeBracketIcon as Code,
  FolderOpenIcon as FolderOpen,
  MagnifyingGlassMinusIcon as ZoomOut,
  MagnifyingGlassPlusIcon as ZoomIn,
} from '@heroicons/react/24/outline';
import { useState, type ComponentProps, type ReactNode } from 'react';
import { cn } from './cn';
import { FileIcon } from './FileIcon';
import { FitWidthIcon } from './FitWidthIcon';
import { IconButton } from './IconButton';

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
  onOpenInFolder,
  onReload,
  controls,
  actions,
}: {
  path: string[];
  mode?: DocumentMode;
  onModeChange?: (mode: DocumentMode) => void;
  previewLabel?: string;
  onOpenInFolder?: () => void;
  onReload: () => void;
  controls?: ReactNode;
  actions?: ReactNode;
}) {
  const name = path.at(-1) ?? '';
  const directories = path.slice(0, -1);
  const source = mode === 'source';
  const [showDirectories, setShowDirectories] = useState(false);
  const fitPath = (nav: HTMLElement | null) => {
    if (!nav || directories.length === 0) return;
    const slot = nav.parentElement!;
    const list = nav.querySelector('ol')!;
    const parents = list.firstElementChild!;
    const filename = list.lastElementChild!;
    const measure = () => {
      const chromeWidth = nav.getBoundingClientRect().width - list.getBoundingClientRect().width;
      const pathWidth = parents.getBoundingClientRect().width + filename.scrollWidth;
      setShowDirectories(chromeWidth + pathWidth <= slot.getBoundingClientRect().width);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(slot);
    observer.observe(parents);
    observer.observe(filename);
    return () => observer.disconnect();
  };
  return (
    <div
      className="flex min-h-row-regular min-w-0 shrink-0 items-center gap-3 px-app text-ui-callout"
      role="toolbar"
      aria-label="文件操作"
    >
      <div className="flex min-w-0 flex-1">
        <nav
          aria-label="文件路径"
          className="glass relative flex h-control-sm min-w-0 items-center gap-2 overflow-hidden rounded-pill px-3 dark:[--glass-rim:transparent]"
          ref={fitPath}
          title={path.join(' / ')}
        >
          <FileIcon path={name} className="size-4 shrink-0 text-ink-2" />
          <ol className="flex min-w-0 items-center">
            {directories.length > 0 && (
              <li
                className={cn(
                  'flex w-max shrink-0 items-center gap-1.5 pr-1.5 whitespace-nowrap text-ink-2',
                  !showDirectories && 'invisible absolute',
                )}
              >
                {directories.map((directory, index) => (
                  <span key={index} className="flex items-center gap-1.5">
                    <span>{directory}</span>
                    <span aria-hidden className="text-ink-4">
                      /
                    </span>
                  </span>
                ))}
              </li>
            )}
            <li aria-current="page" className="min-w-0 truncate text-ink">
              {name}
            </li>
          </ol>
        </nav>
      </div>
      <div className="glass flex shrink-0 items-center gap-1 rounded-pill px-1 py-0.5 dark:[--glass-rim:transparent]">
        {controls && (
          <>
            {controls}
            <DocumentToolbarDivider />
          </>
        )}
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
