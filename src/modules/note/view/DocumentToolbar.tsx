import {
  ArrowPathIcon as RefreshCw,
  ChevronRightIcon as ChevronRight,
  CodeBracketIcon as Code,
  FolderOpenIcon as FolderOpen,
} from '@heroicons/react/24/outline';
import { Button } from '../../../ui/Button';
import { cn } from '../../../ui/cn';
import { Spinner } from '../../../ui/Spinner';

export type NoteMode = 'live' | 'source';

export function DocumentToolbar({
  path,
  markdown,
  mode,
  onModeChange,
  saving,
  dirty,
  failed,
  onOpenInFolder,
  onReload,
}: {
  path: string[];
  markdown: boolean;
  mode: NoteMode;
  onModeChange: (mode: NoteMode) => void;
  saving: boolean;
  dirty: boolean;
  failed: boolean;
  onOpenInFolder?: () => void;
  onReload: () => void;
}) {
  return (
    <div
      className="flex min-w-0 shrink-0 items-center gap-2 px-3 py-1.5 text-ui-subhead"
      role="toolbar"
      aria-label="文件操作"
    >
      <nav aria-label="文件路径" className="min-w-0 flex-1 text-ink-2" title={path.join(' / ')}>
        <ol className="flex min-w-0 items-center gap-1 overflow-hidden">
          {path.map((name, index) => (
            <li key={index} className="flex min-w-0 items-center gap-1 last:text-ink-2">
              {index > 0 && <ChevronRight aria-hidden className="size-4 shrink-0" />}
              <span
                className="truncate"
                aria-current={index === path.length - 1 ? 'page' : undefined}
              >
                {name}
              </span>
            </li>
          ))}
        </ol>
      </nav>
      <span
        className={cn('flex shrink-0 items-center gap-1 text-ink-2', failed && 'text-danger')}
        role="status"
        aria-live="polite"
      >
        {saving ? (
          <>
            <Spinner size="xs" />
            保存中…
          </>
        ) : dirty ? (
          '未保存'
        ) : null}
      </span>
      {markdown && (
        <Button
          size="icon-xs"
          variant={mode === 'source' ? 'secondary' : 'ghost'}
          title={mode === 'source' ? '返回即时渲染' : '源码模式'}
          aria-label={mode === 'source' ? '返回即时渲染' : '源码模式'}
          aria-pressed={mode === 'source'}
          onClick={() => onModeChange(mode === 'source' ? 'live' : 'source')}
        >
          <Code />
        </Button>
      )}
      <div className="flex shrink-0 items-center gap-0.5">
        {onOpenInFolder && (
          <Button
            size="icon-xs"
            variant="ghost"
            title="在文件夹中显示"
            aria-label="在文件夹中显示"
            onClick={onOpenInFolder}
          >
            <FolderOpen />
          </Button>
        )}
        <Button
          size="icon-xs"
          variant="ghost"
          title="重新载入"
          aria-label="重新载入"
          onClick={onReload}
        >
          <RefreshCw />
        </Button>
      </div>
    </div>
  );
}
