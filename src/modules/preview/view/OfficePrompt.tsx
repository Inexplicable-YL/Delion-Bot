import { create } from 'zustand';
import {
  ArrowPathIcon as RefreshCw,
  ArrowTopRightOnSquareIcon as ExternalLink,
  DocumentArrowDownIcon as FileDown,
  PresentationChartBarIcon as Presentation,
} from '@heroicons/react/24/outline';
import { Button } from '../../../ui/Button';
import { useNow } from '../../../ui/use-now';
import { EmptyState } from '../../../ui/EmptyState';
import { showToast } from '../../../ui/Toast';
import { onWorkspaceEvent, workspaceClient } from '../../workspace/view';
import type {
  OfficeExportEvent,
  OfficeExportInfo,
  OfficeExportProgress,
  ResourceRef,
} from '../../workspace/contract';
import { ErrorText } from '../../../ui/Alert';
import { Spinner } from '../../../ui/Spinner';
import { errorMessage } from '../../../core/protocol/contract';

function progressText(progress: OfficeExportProgress | null, opening = false): string {
  if (opening) return '导出完成，正在打开…';
  if (!progress) return '正在导出，可能需要几十秒…';
  if (progress.phase === 'preparing') return '准备文件…';
  if (progress.phase === 'converting') return '正在调用 PowerPoint 转换…';
  const bytes = progress.bytes ?? 0;
  const size =
    bytes >= 1024 * 1024
      ? `${(bytes / 1024 / 1024).toFixed(1)} MB`
      : `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `正在写入 PDF（${size}）…`;
}

const exportKey = (ref: ResourceRef) => ref.id;

interface OfficeExportRun {
  progress: OfficeExportProgress | null;
  startedAt: number;
  opening: boolean;
  error: string;
}

const useOfficeExports = create<{
  runs: Record<string, OfficeExportRun>;
  start: (ref: ResourceRef, onExported?: () => void) => void;
}>((set) => ({
  runs: {},
  start: (ref, onExported) => {
    const key = exportKey(ref);
    const current = useOfficeExports.getState().runs[key];
    if (current && !current.error) return;
    set((state) => ({
      runs: {
        ...state.runs,
        [key]: { progress: null, startedAt: Date.now(), opening: false, error: '' },
      },
    }));
    workspaceClient.exportOfficePdf(ref).then(
      async () => {
        set((state) => {
          const run = state.runs[key];
          if (!run) return state;
          return { runs: { ...state.runs, [key]: { ...run, opening: true } } };
        });
        try {
          await onExported?.();
        } catch {}
        set((state) => {
          const runs = { ...state.runs };
          delete runs[key];
          return { runs };
        });
      },
      (cause) => {
        const message = errorMessage(cause);
        set((state) => {
          const run = state.runs[key];
          if (!run) return state;
          return { runs: { ...state.runs, [key]: { ...run, error: message } } };
        });
      },
    );
  },
}));

if (typeof window !== 'undefined' && window.delionBot)
  onWorkspaceEvent('officeExportProgress', (event: OfficeExportEvent) => {
    const key = exportKey(event.ref);
    useOfficeExports.setState((state) => {
      const run = state.runs[key];
      if (!run) return state;
      return { runs: { ...state.runs, [key]: { ...run, progress: event } } };
    });
  });

function useOfficeExport(ref: ResourceRef | undefined, onExported: (() => void) | undefined) {
  const supported = window.delionBot?.platform === 'win32';
  const active = useOfficeExports((state) => (ref ? state.runs[exportKey(ref)] : undefined));
  const exporting = !!active && !active.error;
  const now = useNow(1000, exporting);
  const elapsed = active ? Math.max(0, Math.round((now - active.startedAt) / 1000)) : 0;
  const run = () => {
    if (supported && ref && window.delionBot) useOfficeExports.getState().start(ref, onExported);
  };
  return {
    supported,
    exporting,
    opening: active?.opening ?? false,
    error: active?.error ?? '',
    run,
    progress: active?.progress ?? null,
    elapsed,
  };
}

export interface OfficePromptProps {
  title: string;
  officeRef: ResourceRef | undefined;
  onExported: (() => void) | undefined;
}

export function OfficePromptCard({ title, officeRef, onExported }: OfficePromptProps) {
  const { supported, exporting, opening, error, run, progress, elapsed } = useOfficeExport(
    officeRef,
    onExported,
  );
  const openExternally = () => {
    if (!officeRef) return;
    workspaceClient.openResourceFile(officeRef).catch((cause) =>
      showToast({
        variant: 'error',
        title: '打开失败',
        description: errorMessage(cause),
      }),
    );
  };
  return (
    <EmptyState
      className="min-h-0 flex-1"
      icon={Presentation}
      title={title}
      description={
        <>
          PowerPoint 演示文稿 · 只读，应用内不直接渲染
          {!supported && (
            <span className="mx-auto mt-2 block max-w-md">
              你可以用系统默认应用打开原文件。当前平台不提供 PPTX 转 PDF，也可以导入已转换的 PDF
              阅读。
            </span>
          )}
        </>
      }
      action={
        <div className="grid justify-items-center gap-3">
          {exporting ? (
            <div
              role="status"
              className="flex flex-col items-center gap-1 text-ui-subhead text-ink-2"
            >
              <Spinner size="lg" />
              <span>{progressText(progress, opening)}</span>
              {!opening && <span className="text-ui-subhead">已进行 {elapsed} 秒</span>}
            </div>
          ) : (
            <div className="flex items-center gap-2">
              {supported && (
                <Button size="sm" onClick={run}>
                  <FileDown aria-hidden />
                  导出为 PDF 预览
                </Button>
              )}
              <Button size="sm" variant="outline" onClick={openExternally}>
                <ExternalLink aria-hidden />
                在外部打开
              </Button>
            </div>
          )}
          {error && <ErrorText className="max-w-md">{error}</ErrorText>}
        </div>
      }
    />
  );
}

export function OfficeExportBanner({
  exported,
  officeRef,
  onExported,
}: Omit<OfficePromptProps, 'title'> & { exported: OfficeExportInfo }) {
  const { supported, exporting, opening, error, run, progress } = useOfficeExport(
    officeRef,
    onExported,
  );
  if (!exported.stale) {
    if (!supported) return null;
    return (
      <div className="flex shrink-0 items-center justify-end gap-2 px-2 pt-1 text-ui-subhead">
        {error && <ErrorText>{error}</ErrorText>}
        <Button size="sm" variant="ghost" onClick={run} disabled={exporting}>
          {exporting ? <Spinner /> : <RefreshCw aria-hidden />}
          {exporting ? progressText(progress, opening) : '重新导出'}
        </Button>
      </div>
    );
  }
  return (
    <div
      role="status"
      className="flex shrink-0 flex-wrap items-center gap-2 border-b px-3 py-1 text-ui-subhead text-ink-2"
    >
      <span>已打开导出的 {exported.title}</span>
      <span className="text-ink">源文件在导出后更新过，内容可能过期</span>
      {supported ? (
        <Button size="sm" variant="ghost" onClick={run} disabled={exporting}>
          {exporting ? <Spinner /> : <RefreshCw aria-hidden />}
          {exporting ? progressText(progress, opening) : '重新导出'}
        </Button>
      ) : (
        <span>当前平台暂不支持重新导出</span>
      )}
      {error && <ErrorText>{error}</ErrorText>}
    </div>
  );
}
