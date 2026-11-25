import { useRef, useState, type ReactNode } from 'react';
import {
  AnnotationMode,
  getDocument,
  GlobalWorkerOptions,
  PDFDataRangeTransport,
  type PDFDocumentLoadingTask,
} from 'pdfjs-dist';
import { EventBus, PDFViewer } from 'pdfjs-dist/web/pdf_viewer.mjs';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import {
  ChevronLeftIcon as ChevronLeft,
  ChevronRightIcon as ChevronRight,
} from '@heroicons/react/24/outline';
import {
  DocumentToolbarButton,
  DocumentToolbarDivider,
  DocumentZoomControls,
} from '../../../ui/DocumentToolbar';
import 'pdfjs-dist/web/pdf_viewer.css';
import { ErrorText } from '../../../ui/Alert';
import { errorMessage } from '../../../core/protocol/contract';
import { fitPageScale } from './page-fit';
import { wheelZoomFactor } from './use-pinch-zoom';

declare const __PDF_ASSET_DIR__: string;
GlobalWorkerOptions.workerSrc = workerUrl;
const MAX_PIXELS = 4 * 1024 * 1024;
const DRAWING_DELAY = 400;

export function PdfReader({
  url,
  initialScroll,
  onScroll,
  toolbar,
}: {
  url: string;
  initialScroll: () => number;
  onScroll?: (top: number) => void;
  toolbar: (controls: ReactNode) => ReactNode;
}) {
  const viewer = useRef<{
    instance: PDFViewer;
    fit: () => void;
    release: () => void;
  } | null>(null);
  const [position] = useState(() => {
    let top = initialScroll();
    return {
      read: () => top,
      write: (next: number) => {
        top = next;
      },
    };
  });
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [pageCount, setPageCount] = useState(0);
  const [current, setCurrent] = useState(1);
  const [pageDraft, setPageDraft] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const attachViewer = (pages: HTMLDivElement | null) => {
    if (!pages) return;
    let initialized = false;
    const element = pages.parentElement as HTMLDivElement;
    const controller = new AbortController();
    const lifecycle = new AbortController();
    const eventBus = new EventBus();
    const options = {
      container: element,
      viewer: pages,
      eventBus,
      removePageBorders: true,
      annotationMode: AnnotationMode.DISABLE,
      enableAutoLinking: false,
      maxCanvasPixels: MAX_PIXELS,
      enableDetailCanvas: false,
      abortSignal: lifecycle.signal,
    };
    const instance = new PDFViewer(options);
    let fitting = true;
    const fit = () => {
      const page = instance.getPageView(0);
      if (page)
        instance.currentScale = fitPageScale(element.clientWidth, page.viewport.width / page.scale);
    };
    viewer.current = {
      instance,
      fit: () => {
        fitting = true;
        fit();
      },
      release: () => {
        fitting = false;
      },
    };
    let task: PDFDocumentLoadingTask | undefined;
    const fail = (error: unknown) => {
      if (controller.signal.aborted) return;
      setError(errorMessage(error));
      initialized = false;
      setPageCount(0);
      controller.abort();
      instance.setDocument(null!);
      void task?.destroy();
    };
    const savePosition = () => {
      if (!initialized || controller.signal.aborted) return;
      const index = instance.currentPageNumber - 1;
      const page = instance.getPageView(index).div;
      if (!page.clientHeight) return;
      const top = Math.max(
        0,
        index +
          Math.max(0, Math.min(0.999, (element.scrollTop - page.offsetTop) / page.clientHeight)),
      );
      position.write(top);
      onScroll?.(top);
    };
    eventBus.on('pagesinit', () => {
      if (controller.signal.aborted) return;
      fit();
      const index = Math.min(instance.pagesCount - 1, Math.floor(position.read()));
      instance.currentPageNumber = index + 1;
      const page = instance.getPageView(index).div;
      element.scrollTop = page.offsetTop + (position.read() % 1) * page.clientHeight;
      initialized = true;
      setPageCount(instance.pagesCount);
      instance.update();
    });
    eventBus.on('pagechanging', ({ pageNumber }: { pageNumber: number }) => {
      setCurrent(pageNumber);
    });
    eventBus.on('scalechanging', ({ scale }: { scale: number }) => setZoom(scale));
    eventBus.on('updateviewarea', savePosition);
    eventBus.on('pagerendered', ({ error }: { error?: unknown }) => {
      if (error) fail(error);
    });
    const resize = new ResizeObserver(() => {
      if (!initialized) return;
      if (fitting) fit();
      instance.update();
    });
    resize.observe(element);
    const wheel = (event: WheelEvent) => {
      if (!event.ctrlKey || !initialized) return;
      event.preventDefault();
      fitting = false;
      instance.update();
      const bounds = element.getBoundingClientRect();
      instance.updateScale({
        scaleFactor: wheelZoomFactor(event),
        drawingDelay: DRAWING_DELAY,
        origin: [
          event.clientX - bounds.left + element.offsetLeft,
          event.clientY - bounds.top + element.offsetTop,
        ],
      });
    };
    element.addEventListener('wheel', wheel, { passive: false, signal: lifecycle.signal });
    const assetBase = new URL(
      import.meta.env.DEV ? '/@fs/' + __PDF_ASSET_DIR__ + '/' : './pdfjs/',
      document.baseURI,
    ).href;
    void (async () => {
      const initial = await fetch(url, {
        headers: { Range: 'bytes=0-65535' },
        signal: controller.signal,
      });
      const length = Number(initial.headers.get('content-range')?.split('/')[1]);
      if (initial.status !== 206 || !Number.isSafeInteger(length) || length <= 0)
        throw new Error('无法分段读取 PDF');
      const bytes = new Uint8Array(await initial.arrayBuffer());
      if (controller.signal.aborted) return;
      const range = new PDFDataRangeTransport(length, bytes, true);
      range.requestDataRange = (begin, end) => {
        void fetch(url, {
          headers: { Range: `bytes=${begin}-${end - 1}` },
          signal: controller.signal,
        })
          .then(async (response) => {
            if (response.status !== 206) throw new Error('PDF 分段读取失败');
            const data = new Uint8Array(await response.arrayBuffer());
            if (data.length !== end - begin) throw new Error('PDF 分段数据不完整');
            if (!controller.signal.aborted) range.onDataRange(begin, data);
          })
          .catch(fail);
      };
      range.abort = () => controller.abort();
      task = getDocument({
        range,
        cMapUrl: assetBase + 'cmaps/',
        cMapPacked: true,
        standardFontDataUrl: assetBase + 'standard_fonts/',
        wasmUrl: assetBase + 'wasm/',
        disableAutoFetch: true,
        disableStream: true,
        canvasMaxAreaInBytes: MAX_PIXELS * 4,
      });
      const doc = await task.promise;
      if (controller.signal.aborted) return;
      instance.setDocument(doc);
    })().catch(fail);
    return () => {
      resize.disconnect();
      lifecycle.abort();
      controller.abort();
      instance.setDocument(null!);
      viewer.current = null;
      void task?.destroy();
    };
  };
  const go = (page: number) => {
    if (viewer.current && Number.isFinite(page) && pageCount)
      viewer.current.instance.currentPageNumber = Math.min(
        pageCount,
        Math.max(1, Math.trunc(page)),
      );
  };
  const rescale = (change: (instance: PDFViewer) => void) => {
    if (!viewer.current) return;
    viewer.current.release();
    change(viewer.current.instance);
  };
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      {toolbar(
        <>
          <DocumentToolbarButton
            label="上一页"
            disabled={!pageCount || current === 1}
            onClick={() => go(current - 1)}
          >
            <ChevronLeft />
          </DocumentToolbarButton>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              go(Number(pageDraft));
              e.currentTarget.querySelector('input')?.blur();
            }}
          >
            <label className="group flex h-6 min-w-14 cursor-text items-center justify-center gap-1 rounded-pill bg-surface px-2.5 tabular-nums shadow-hairline focus-within:shadow-focus">
              <input
                aria-label="PDF 页码"
                className="min-w-2 bg-transparent text-center text-ink outline-none [field-sizing:content]"
                inputMode="numeric"
                value={pageDraft ?? String(current)}
                onChange={(e) => setPageDraft(e.target.value)}
                onFocus={(e) => {
                  setPageDraft(String(current));
                  e.currentTarget.select();
                }}
                onBlur={() => setPageDraft(null)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') e.currentTarget.blur();
                }}
              />
              <span aria-hidden className="text-ink group-focus-within:hidden">
                / {pageCount || '…'}
              </span>
            </label>
          </form>
          <DocumentToolbarButton
            label="下一页"
            disabled={!pageCount || current === pageCount}
            onClick={() => go(current + 1)}
          >
            <ChevronRight />
          </DocumentToolbarButton>
          <DocumentToolbarDivider />
          <DocumentZoomControls
            zoom={zoom}
            disabled={!pageCount}
            zoomOutLabel="缩小 PDF"
            zoomInLabel="放大 PDF"
            onZoomOut={() =>
              rescale((instance) => instance.decreaseScale({ drawingDelay: DRAWING_DELAY }))
            }
            onZoomIn={() =>
              rescale((instance) => instance.increaseScale({ drawingDelay: DRAWING_DELAY }))
            }
            onReset={() =>
              rescale((instance) => {
                instance.currentScaleValue = '1';
              })
            }
            onFit={() => viewer.current?.fit()}
          />
        </>,
      )}
      <div className="relative min-h-0 flex-1">
        <div className="absolute inset-0 overflow-auto overscroll-contain [overflow-anchor:none] [scrollbar-gutter:stable]">
          <div
            key={`${url}:${attempt}`}
            ref={attachViewer}
            className="pdfViewer delion-pdf-pages"
          />
        </div>
        {error && (
          <ErrorText size="sm" className="absolute inset-x-0 top-0 bg-surface p-3">
            PDF 打开失败：{error}
            <button
              className="ml-2 underline"
              onClick={() => {
                setPageCount(0);
                setError('');
                setAttempt((value) => value + 1);
              }}
            >
              重试
            </button>
          </ErrorText>
        )}
        {!pageCount && !error && (
          <p role="status" className="absolute inset-x-0 top-0 p-3 text-ui-body text-ink-2">
            正在加载 PDF…
          </p>
        )}
      </div>
    </div>
  );
}
