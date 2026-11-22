import { useRef, useState } from 'react';
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
  ArrowsRightLeftIcon as MoveHorizontal,
  ChevronLeftIcon as ChevronLeft,
  ChevronRightIcon as ChevronRight,
  MinusIcon as Minus,
  PlusIcon as Plus,
} from '@heroicons/react/24/outline';
import { Button } from '../../../ui/Button';
import 'pdfjs-dist/web/pdf_viewer.css';
import { ErrorText } from '../../../ui/Alert';
import { errorMessage } from '../../../core/protocol/contract';

declare const __PDF_ASSET_DIR__: string;
GlobalWorkerOptions.workerSrc = workerUrl;
const MAX_PIXELS = 4 * 1024 * 1024;
const DRAWING_DELAY = 400;

export function PdfReader({
  url,
  initialScroll,
  onScroll,
}: {
  url: string;
  initialScroll: () => number;
  onScroll?: (top: number) => void;
}) {
  const viewer = useRef<PDFViewer | null>(null);
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
  const [pageInput, setPageInput] = useState('1');
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
    viewer.current = instance;
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
      instance.currentScaleValue = 'page-width';
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
      setPageInput(String(pageNumber));
    });
    eventBus.on('scalechanging', ({ scale }: { scale: number }) => setZoom(scale));
    eventBus.on('updateviewarea', savePosition);
    eventBus.on('pagerendered', ({ error }: { error?: unknown }) => {
      if (error) fail(error);
    });
    const resize = new ResizeObserver(() => {
      if (!initialized) return;
      if (instance.currentScaleValue === 'page-width') instance.currentScaleValue = 'page-width';
      instance.update();
    });
    resize.observe(element);
    const wheel = (event: WheelEvent) => {
      if (!event.ctrlKey || !initialized) return;
      event.preventDefault();
      instance.update();
      const bounds = element.getBoundingClientRect();
      instance.updateScale({
        ...(event.deltaMode === WheelEvent.DOM_DELTA_PIXEL
          ? { scaleFactor: Math.exp(-event.deltaY / 100) }
          : { steps: -Math.sign(event.deltaY) }),
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
      viewer.current.currentPageNumber = Math.min(pageCount, Math.max(1, Math.trunc(page)));
  };
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center justify-center-safe gap-2 overflow-x-auto border-b px-3 py-1 text-ui-subhead">
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label="上一页"
          disabled={!pageCount || current === 1}
          onClick={() => go(current - 1)}
        >
          <ChevronLeft />
        </Button>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            go(Number(pageInput));
          }}
        >
          <input
            aria-label="PDF 页码"
            className="w-12 rounded border border-line bg-surface px-1 text-center"
            value={pageInput}
            onChange={(e) => setPageInput(e.target.value)}
          />
          <span className="ml-2 text-ink-2">/ {pageCount || '…'}</span>
        </form>
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label="下一页"
          disabled={!pageCount || current === pageCount}
          onClick={() => go(current + 1)}
        >
          <ChevronRight />
        </Button>
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label="缩小 PDF"
          disabled={!pageCount}
          onClick={() => viewer.current?.decreaseScale({ drawingDelay: DRAWING_DELAY })}
        >
          <Minus />
        </Button>
        <button
          title="重置缩放到 100%"
          aria-label="重置缩放到 100%"
          disabled={!pageCount}
          className="rounded-control px-2 outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          onClick={() => {
            if (viewer.current) viewer.current.currentScaleValue = '1';
          }}
        >
          {Math.round(zoom * 100)}%
        </button>
        <Button
          size="icon-sm"
          variant="ghost"
          title="适合宽度"
          aria-label="适合宽度"
          disabled={!pageCount}
          onClick={() => {
            if (viewer.current) viewer.current.currentScaleValue = 'page-width';
          }}
        >
          <MoveHorizontal />
        </Button>
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label="放大 PDF"
          disabled={!pageCount}
          onClick={() => viewer.current?.increaseScale({ drawingDelay: DRAWING_DELAY })}
        >
          <Plus />
        </Button>
      </div>
      <div className="relative min-h-0 flex-1">
        <div className="absolute inset-0 overflow-auto overscroll-contain bg-inset [overflow-anchor:none] [scrollbar-gutter:stable]">
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
