import { useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from 'react';
import { skipToken, useQuery } from '@tanstack/react-query';
import { ArrowDownTrayIcon, ArrowUpIcon, XMarkIcon } from '@heroicons/react/24/outline';
import { Dialog } from 'radix-ui';
import { errorMessage } from '../../../core/protocol/contract';
import { cn } from '../../../ui/cn';
import { IconButton } from '../../../ui/IconButton';
import { overlayFade } from '../../../ui/motion';
import { showToast } from '../../../ui/Toast';
import { WindowControls } from '../../../ui/WindowControls';
import type { ImagePreview } from '../contract';
import { chatClient } from './client';
import { useReplyImageContext } from './ReplyImageContext';
import { fetchImagePreview, imageQuestion, type ReplyImagePreview } from './reply-images';
import { ZoomableImage } from '../../../ui/ZoomableImage';

const viewerSurface = 'bg-surface ring-1 ring-inset ring-line';
const viewerButton = `${viewerSurface} size-control-md rounded-full hover:bg-hover-strong`;

export type ViewerImage = {
  src: string;
  title: string;
  preview?: ImagePreview | null;
  mediaId?: string;
};

const thumbnailLimit = 9;
const thumbnailSize = 12;
const thumbnailGap = 2;

function isBackdrop(target: EventTarget): boolean {
  return target instanceof HTMLElement && target.dataset.backdrop !== undefined;
}

function ViewerWindowControls() {
  const windowState = useQuery({
    queryKey: ['window', 'state'],
    queryFn: () => window.delionBot!.window.getState(),
    enabled: Boolean(window.delionBot),
  });
  if (!window.delionBot || window.delionBot.platform === 'darwin') return null;
  return (
    <WindowControls
      className="-mr-4 ml-2"
      maximized={windowState.data?.maximized ?? false}
      onClose={() => window.delionBot?.window.close()}
      onMinimize={() => window.delionBot?.window.minimize()}
      onToggleMaximize={() => window.delionBot?.window.toggleMaximize()}
    />
  );
}

function centerThumbnail(
  rail: HTMLDivElement,
  button: HTMLButtonElement,
  behavior: ScrollBehavior,
) {
  rail.scrollTo({
    left: button.offsetLeft + (button.offsetWidth - rail.clientWidth) / 2,
    behavior,
  });
}

function ImageThumbnailRail({
  images,
  index,
  onIndexChange,
}: {
  images: ViewerImage[];
  index: number;
  onIndexChange?: (index: number) => void;
}) {
  const railRef = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ start: false, end: false });
  const updateEdges = (rail: HTMLDivElement) => {
    const start = rail.scrollLeft > 1;
    const end = rail.scrollWidth - rail.clientWidth - rail.scrollLeft > 1;
    setEdges((current) =>
      current.start === start && current.end === end ? current : { start, end },
    );
  };
  const [attachRail] = useState(() => (rail: HTMLDivElement | null) => {
    if (!rail) return;
    railRef.current = rail;
    const align = () => {
      const selected = rail.querySelector<HTMLButtonElement>('button[aria-current="true"]');
      if (selected) centerThumbnail(rail, selected, 'instant');
      updateEdges(rail);
    };
    align();
    const observer = new ResizeObserver(align);
    observer.observe(rail);
    return () => {
      observer.disconnect();
      railRef.current = null;
    };
  });
  const [selectThumbnail] = useState(() => (button: HTMLButtonElement | null) => {
    const rail = railRef.current;
    if (!button || !rail) return;
    if (rail.contains(document.activeElement)) button.focus({ preventScroll: true });
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    centerThumbnail(rail, button, reduced ? 'instant' : 'smooth');
  });
  const width =
    (thumbnailLimit - 1) * (thumbnailSize + thumbnailGap) +
    (images.length > thumbnailLimit ? thumbnailGap : thumbnailSize);
  const fade = `calc(var(--spacing) * ${thumbnailSize / 2})`;
  const maskImage =
    edges.start || edges.end
      ? `linear-gradient(to right, ${edges.start ? 'transparent' : 'black'}, black ${fade}, black calc(100% - ${fade}), ${edges.end ? 'transparent' : 'black'})`
      : undefined;

  return (
    <div
      className="relative mt-8.5 flex w-max min-w-0 shrink-0 overflow-x-auto scrollbar-none"
      onScroll={(event) => updateEdges(event.currentTarget)}
      ref={attachRail}
      style={{
        gap: `calc(var(--spacing) * ${thumbnailGap})`,
        maskImage,
        maxWidth: `min(100%, calc(var(--spacing) * ${width}))`,
      }}
    >
      {images.map((item, itemIndex) => {
        const selected = itemIndex === index;
        return (
          <button
            aria-current={selected || undefined}
            aria-label={`查看第 ${itemIndex + 1} 张：${item.title}`}
            className={cn(
              'group shrink-0 overflow-hidden rounded-control',
              selected && 'p-1 outline-2 -outline-offset-2 outline-ink',
            )}
            key={itemIndex}
            onClick={() => onIndexChange?.(itemIndex)}
            ref={selected ? selectThumbnail : undefined}
            style={{ width: `calc(var(--spacing) * ${thumbnailSize})`, aspectRatio: 1 }}
            tabIndex={selected ? 0 : -1}
            type="button"
          >
            {item.preview !== undefined && (
              <span
                className={cn(
                  'block size-full overflow-hidden bg-media',
                  selected && 'rounded-chip',
                )}
              >
                <img
                  alt=""
                  className={cn(
                    'size-full object-cover',
                    !selected &&
                      'opacity-60 transition-opacity duration-fast group-hover:opacity-100',
                  )}
                  decoding="async"
                  loading="lazy"
                  src={item.preview?.url ?? item.src}
                />
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

export function ImageViewer({
  images,
  index,
  onIndexChange,
  onClose,
  onDownload,
  footer,
}: {
  images: ViewerImage[];
  index: number;
  onIndexChange?: (index: number) => void;
  onClose: () => void;
  onDownload: () => Promise<boolean>;
  footer?: ReactNode;
}) {
  const image = images[index]!;
  const [pressedBackdrop, setPressedBackdrop] = useState(false);
  const mediaId = image.mediaId;
  const mediaPreview = useQuery({
    queryKey: ['chat', 'image-preview', image.src],
    queryFn: mediaId ? () => fetchImagePreview({ id: mediaId }) : skipToken,
    staleTime: Infinity,
    retry: false,
  });
  const preview = mediaId
    ? mediaPreview.isPending
      ? undefined
      : (mediaPreview.data ?? null)
    : image.preview;

  const download = () =>
    void onDownload()
      .then((saved) => saved && showToast({ variant: 'success', title: '图片已保存' }))
      .catch((error) =>
        showToast({ variant: 'error', title: '下载失败', description: errorMessage(error) }),
      );

  const navigate = (event: KeyboardEvent) => {
    if (event.target instanceof HTMLElement && event.target.closest('input, [contenteditable]'))
      return;
    const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
    if (!step) return;
    event.preventDefault();
    const next = index + step;
    if (next >= 0 && next < images.length) onIndexChange?.(next);
  };

  return (
    <Dialog.Root open onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className={`fixed inset-0 z-scrim bg-page ${overlayFade}`} />
        <Dialog.Content
          aria-describedby={undefined}
          aria-modal="true"
          className="fixed inset-0 z-overlay flex flex-col items-center px-4 pb-3 pt-1.5 text-ink outline-none [-webkit-app-region:no-drag]"
          data-backdrop
          onClick={(event) => {
            if (pressedBackdrop && isBackdrop(event.target)) onClose();
          }}
          onKeyDown={navigate}
          onPointerDown={(event) => setPressedBackdrop(isBackdrop(event.target))}
        >
          <div
            className="relative flex h-10 w-full shrink-0 items-center justify-center"
            data-backdrop
          >
            <Dialog.Title
              className={`${viewerSurface} flex h-10 max-w-1/2 items-center truncate rounded-full px-4 text-ui-title-3`}
            >
              {image.title}
            </Dialog.Title>
            <div className="absolute -right-4 flex items-center gap-2 pr-4">
              <IconButton
                aria-label="下载图片"
                className={viewerButton}
                onClick={download}
                size="lg"
              >
                <ArrowDownTrayIcon />
              </IconButton>
              <Dialog.Close asChild>
                <IconButton aria-label="关闭图片" className={viewerButton} size="lg">
                  <XMarkIcon />
                </IconButton>
              </Dialog.Close>
              <ViewerWindowControls />
            </div>
          </div>
          {preview === undefined ? (
            <div className="mt-15 min-h-0 w-full flex-1" data-backdrop />
          ) : (
            <ZoomableImage
              alt={image.title}
              className="mt-15 min-h-0 w-full flex-1"
              data-backdrop
              imageClassName="rounded-chip"
              key={image.src}
              preview={preview}
              src={image.src}
            />
          )}
          <p className="mt-4.5 text-ui-subhead tabular-nums text-ink-2">
            {images.length > 1 ? `${image.title} · ${index + 1} / ${images.length}` : image.title}
          </p>
          {images.length > 1 && (
            <ImageThumbnailRail images={images} index={index} onIndexChange={onIndexChange} />
          )}
          {footer}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export function ImageQuestionForm({
  label,
  onAsk,
}: {
  label: string;
  onAsk: (question: string) => Promise<void>;
}) {
  const [question, setQuestion] = useState('');

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const text = question.trim();
    if (!text) return;
    try {
      await onAsk(text);
    } catch (error) {
      showToast({ variant: 'error', title: '发送失败', description: errorMessage(error) });
    }
  };

  return (
    <form
      className={`${viewerSurface} mt-5 flex h-control-lg w-full max-w-138 shrink-0 items-center gap-2 rounded-full pl-4 pr-2`}
      onSubmit={(event) => void submit(event)}
    >
      <input
        aria-label={label}
        className="min-w-0 flex-1 bg-transparent text-ui-body text-ink outline-none placeholder:text-ink-2"
        onChange={(event) => setQuestion(event.target.value)}
        placeholder={label}
        value={question}
      />
      <IconButton
        aria-label="发送"
        className="size-7 rounded-full bg-ink text-page hover:bg-ink hover:text-page disabled:opacity-100"
        disabled={!question.trim()}
        type="submit"
      >
        <ArrowUpIcon />
      </IconButton>
    </form>
  );
}

export function ReplyImageViewer({
  images,
  index,
  onIndexChange,
  onClose,
}: {
  images: ReplyImagePreview[];
  index: number;
  onIndexChange: (index: number) => void;
  onClose: () => void;
}) {
  const reply = useReplyImageContext();
  if (!reply) return null;
  const image = images[index]!;
  const { sessionId, cwd, ask } = reply;
  const source = 'url' in image ? { url: image.url } : { path: image.path };

  return (
    <ImageViewer
      footer={
        ask && (
          <ImageQuestionForm
            label={`关于“${image.alt || '图片'}”的追问`}
            onAsk={async (question) => {
              const input = await imageQuestion(sessionId, cwd, image, question);
              onClose();
              void ask(input.text, input.context);
            }}
          />
        )
      }
      images={images.map((item) => ({
        preview: item.preview,
        src: item.src,
        title: item.alt || '图片',
      }))}
      index={index}
      onClose={onClose}
      onDownload={() => chatClient.saveReplyImage({ sessionId, image: source })}
      onIndexChange={onIndexChange}
    />
  );
}
