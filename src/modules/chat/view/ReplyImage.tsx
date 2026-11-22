import { useState } from 'react';
import { useQueries } from '@tanstack/react-query';
import { cn } from '../../../ui/cn';
import { useReplyImageContext } from './ReplyImageContext';
import { ReplyImageViewer } from './ReplyImageViewer';
import {
  FALLBACK_RATIO,
  GALLERY_MIN_TILE,
  fetchImagePreview,
  galleryLayout,
  replyImageSrc,
  type ReplyImageItem,
  type ReplyImagePreview,
} from './reply-images';

const tileClass = 'relative shrink-0 cursor-zoom-in overflow-hidden rounded-control bg-inset';

function FailedImage({ className, style }: { className?: string; style?: object }) {
  return (
    <span
      className={cn(
        'grid place-items-center bg-inset p-3 text-center text-ui-subhead text-ink-2',
        className,
      )}
      style={style}
    >
      图片无法显示
    </span>
  );
}

function SingleImage({ image, onOpen }: { image: ReplyImagePreview; onOpen: () => void }) {
  const [failed, setFailed] = useState(false);
  return (
    <button
      aria-label={`放大查看 ${image.alt || '图片'}`}
      className="my-1 mr-2 inline-block max-w-full cursor-zoom-in align-top"
      onClick={onOpen}
      title={image.alt || undefined}
      type="button"
    >
      {failed ? (
        <FailedImage className="size-40 max-w-full rounded-control" />
      ) : image.preview === undefined ? (
        <span className="block size-40 max-w-full rounded-control bg-inset" />
      ) : (
        <img
          alt={image.alt}
          className="h-40 w-auto max-w-full rounded-control object-contain"
          loading="lazy"
          onError={() => setFailed(true)}
          decoding="async"
          src={image.preview?.url ?? image.src}
        />
      )}
    </button>
  );
}

function ImageGallery({
  images,
  onOpen,
}: {
  images: ReplyImagePreview[];
  onOpen: (index: number) => void;
}) {
  const [width, setWidth] = useState(0);
  const [ratios, setRatios] = useState<Record<number, number>>({});
  const [failed, setFailed] = useState<Record<number, true>>({});
  const [observe] = useState(() => (element: HTMLSpanElement | null) => {
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry!.contentRect.width));
    observer.observe(element);
    return () => observer.disconnect();
  });
  const ratioList = images.map(({ preview }, index) =>
    failed[index]
      ? 1
      : preview
        ? preview.width / preview.height
        : (ratios[index] ?? FALLBACK_RATIO),
  );
  const { height, shown, overflow } = galleryLayout(ratioList, width);
  return (
    <span ref={observe} className="my-1 flex w-full gap-2 overflow-hidden">
      {images.map((image, index) => {
        const last = overflow && index === shown - 1;
        const style = last
          ? { height, flex: '1 1 0', minWidth: GALLERY_MIN_TILE }
          : { height, width: ratioList[index]! * height };
        const label = image.alt || '图片';
        return (
          <button
            aria-label={last ? `查看全部 ${images.length} 张图片` : `放大查看 ${label}`}
            className={cn(tileClass, index >= shown && 'hidden')}
            key={index}
            onClick={() => onOpen(index)}
            style={style}
            title={image.alt || undefined}
            type="button"
          >
            {failed[index] ? (
              <FailedImage className="size-full" />
            ) : image.preview !== undefined && index < shown ? (
              <img
                alt={image.alt}
                className="size-full object-cover"
                onError={() => setFailed((current) => ({ ...current, [index]: true }))}
                loading="lazy"
                onLoad={(event) => {
                  if (image.preview) return;
                  const { naturalWidth, naturalHeight } = event.currentTarget;
                  if (naturalHeight)
                    setRatios((current) => ({ ...current, [index]: naturalWidth / naturalHeight }));
                }}
                decoding="async"
                src={image.preview?.url ?? image.src}
              />
            ) : null}
            {last && (
              <span className="absolute inset-0 grid place-items-center bg-media/50 text-ui-title-1 text-on-media">
                +{images.length - shown + 1}
              </span>
            )}
          </button>
        );
      })}
    </span>
  );
}

export function ReplyImages({ images }: { images: ReplyImageItem[] }) {
  const [viewing, setViewing] = useState<number | null>(null);
  const { sessionId } = useReplyImageContext()!;
  const sources = images.map((image) => replyImageSrc(sessionId, image));
  const previews = useQueries({
    queries: images.map((image, index) => ({
      queryKey: ['chat', 'image-preview', sources[index]],
      queryFn: () => fetchImagePreview({ sessionId, image }),
      enabled: Boolean(window.delionBot),
      staleTime: 5 * 60 * 1000,
      retry: false,
    })),
  });
  const items = images.map((image, index) => ({
    ...image,
    src: sources[index]!,
    preview:
      window.delionBot && previews[index]!.isPending ? undefined : (previews[index]!.data ?? null),
  }));
  return (
    <>
      {items.length === 1 ? (
        <SingleImage image={items[0]!} onOpen={() => setViewing(0)} />
      ) : (
        <ImageGallery images={items} onOpen={setViewing} />
      )}
      {viewing !== null && (
        <ReplyImageViewer
          images={items}
          index={viewing}
          onClose={() => setViewing(null)}
          onIndexChange={setViewing}
        />
      )}
    </>
  );
}
