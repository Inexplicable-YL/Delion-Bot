import { renderAsync } from 'docx-preview';
import { MinusIcon as Minus, PlusIcon as Plus } from '@heroicons/react/24/outline';
import { useState } from 'react';
import { Button } from '../../../ui/Button';
import { pinchZoomRef } from './use-pinch-zoom';
import { ErrorText } from '../../../ui/Alert';
import { errorMessage } from '../../../core/protocol/contract';

const MIN_ZOOM = 0.5;
const MAX_ZOOM = 3;
const ZOOM_STEP = 0.1;

export function DocxPreview({ url }: { url: string }) {
  const [attempt, setAttempt] = useState(0);
  const run = `${attempt}:${url}`;
  const [result, setResult] = useState<{ run: string; error: string } | null>(null);
  const loading = result?.run !== run;
  const error = loading ? '' : result.error;
  const [zoom, setZoom] = useState(1);
  const mountDocument = (container: HTMLDivElement | null) => {
    if (!container) return;
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch(url, { signal: controller.signal });
        if (!response.ok) {
          if (!controller.signal.aborted) setResult({ run, error: `HTTP ${response.status}` });
          return;
        }
        const bytes = await response.arrayBuffer();
        if (controller.signal.aborted) return;
        await renderAsync(bytes, container, undefined, {
          useBase64URL: true,
          renderAltChunks: false,
        });
        container.querySelectorAll('a[href]').forEach((a) => {
          try {
            if (!['https:', 'http:'].includes(new URL(a.getAttribute('href')!).protocol))
              a.removeAttribute('href');
          } catch {
            a.removeAttribute('href');
          }
        });
        if (!controller.signal.aborted) setResult({ run, error: '' });
      } catch (cause) {
        if (!controller.signal.aborted) setResult({ run, error: errorMessage(cause) });
      }
    })();
    return () => controller.abort();
  };
  const step = (direction: number) =>
    setZoom((value) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, value + direction * ZOOM_STEP)));
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center justify-center-safe gap-2 overflow-x-auto border-b px-3 py-1 text-ui-subhead">
        <Button size="icon-sm" variant="ghost" aria-label="缩小文档" onClick={() => step(-1)}>
          <Minus />
        </Button>
        <button
          title="重置缩放到 100%"
          aria-label="重置缩放到 100%"
          className="rounded-control px-2 outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          onClick={() => setZoom(1)}
        >
          {Math.round(zoom * 100)}%
        </button>
        <Button size="icon-sm" variant="ghost" aria-label="放大文档" onClick={() => step(1)}>
          <Plus />
        </Button>
      </div>
      <div className="relative min-h-0 flex-1">
        <div
          ref={pinchZoomRef(setZoom, MIN_ZOOM, MAX_ZOOM, ZOOM_STEP)}
          className="absolute inset-0 overflow-auto overscroll-contain bg-inset [overflow-anchor:none] [scrollbar-gutter:stable]"
        >
          <div
            key={run}
            ref={mountDocument}
            style={{ zoom }}
            className="docx-preview-host min-h-full"
          />
        </div>
        {error && (
          <ErrorText size="sm" className="absolute inset-x-0 top-0 bg-surface p-3">
            文档打开失败：{error}
            <button className="ml-2 underline" onClick={() => setAttempt((value) => value + 1)}>
              重试
            </button>
          </ErrorText>
        )}
        {loading && !error && (
          <p role="status" className="absolute inset-x-0 top-0 p-3 text-ui-body text-ink-2">
            正在加载文档…
          </p>
        )}
      </div>
    </div>
  );
}
