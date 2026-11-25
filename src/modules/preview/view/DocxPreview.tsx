import { renderAsync } from 'docx-preview';
import { useState, type ReactNode } from 'react';
import { DocumentZoomControls } from '../../../ui/DocumentToolbar';
import { pinchZoomRef } from './use-pinch-zoom';
import { fitPageScale } from './page-fit';
import { ErrorText } from '../../../ui/Alert';
import { errorMessage } from '../../../core/protocol/contract';

const MIN_ZOOM = 0.5;
const MAX_ZOOM = 3;
const ZOOM_STEP = 0.1;
const POINTS_TO_PIXELS = 96 / 72;

const cssPixels = (length: string) =>
  parseFloat(length) * (length.endsWith('pt') ? POINTS_TO_PIXELS : 1);

export function DocxPreview({
  url,
  toolbar,
}: {
  url: string;
  toolbar: (controls: ReactNode) => ReactNode;
}) {
  const [attempt, setAttempt] = useState(0);
  const run = `${attempt}:${url}`;
  const [result, setResult] = useState<{ run: string; error: string } | null>(null);
  const loading = result?.run !== run;
  const error = loading ? '' : result.error;
  const [fitZoom, setFitZoom] = useState(1);
  const [manualZoom, setManualZoom] = useState<number | null>(null);
  const zoom = manualZoom ?? fitZoom;
  const changeZoom = (update: (value: number) => number) =>
    setManualZoom((value) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, update(value ?? fitZoom))));
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
        if (controller.signal.aborted) return;
        const page = container.querySelector<HTMLElement>('section.docx');
        const scroller = container.parentElement;
        const pageWidth = page ? cssPixels(page.style.width) : 0;
        if (scroller && pageWidth > 0) {
          const resize = new ResizeObserver(() =>
            setFitZoom(fitPageScale(scroller.clientWidth, pageWidth)),
          );
          resize.observe(scroller);
          controller.signal.addEventListener('abort', () => resize.disconnect());
        }
        setResult({ run, error: '' });
      } catch (cause) {
        if (!controller.signal.aborted) setResult({ run, error: errorMessage(cause) });
      }
    })();
    return () => controller.abort();
  };
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      {toolbar(
        <DocumentZoomControls
          zoom={zoom}
          zoomOutLabel="缩小文档"
          zoomInLabel="放大文档"
          onZoomOut={() => changeZoom((value) => value - ZOOM_STEP)}
          onZoomIn={() => changeZoom((value) => value + ZOOM_STEP)}
          onReset={() => setManualZoom(1)}
          onFit={() => setManualZoom(null)}
        />,
      )}
      <div className="relative min-h-0 flex-1">
        <div
          ref={pinchZoomRef(changeZoom, MIN_ZOOM, MAX_ZOOM)}
          className="absolute inset-0 overflow-auto overscroll-contain [overflow-anchor:none] [scrollbar-gutter:stable]"
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
