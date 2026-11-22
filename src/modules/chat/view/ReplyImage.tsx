import { useState } from 'react';
import { cn } from '../../../ui/cn';
import { useReplyImageContext } from './ReplyImageContext';
import { ReplyImageViewer } from './ReplyImageViewer';
import {
  FALLBACK_RATIO,
  GALLERY_MIN_TILE,
  galleryLayout,
  replyImageSrc,
  type ReplyImageItem,
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

function SingleImage({ image, onOpen }: { image: ReplyImageItem; onOpen: () => void }) {
  const reply = useReplyImageContext()!;
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
      ) : (
        <img
          alt={image.alt}
          className="h-40 w-auto max-w-full rounded-control object-contain"
          loading="lazy"
          onError={() => setFailed(true)}
          src={replyImageSrc(reply.sessionId, image)}
        />
      )}
    </button>
  );
}

function ImageGallery({
  images,
  onOpen,
}: {
  images: ReplyImageItem[];
  onOpen: (index: number) => void;
}) {
  const reply = useReplyImageContext()!;
  const [width, setWidth] = useState(0);
  const [ratios, setRatios] = useState<Record<number, number>>({});
  const [failed, setFailed] = useState<Record<number, true>>({});
  const [observe] = useState(() => (element: HTMLSpanElement | null) => {
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry!.contentRect.width));
    observer.observe(element);
    return () => observer.disconnect();
  });
  const ratioList = images.map((_, index) =>
    failed[index] ? 1 : (ratios[index] ?? FALLBACK_RATIO),
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
            ) : (
              <img
                alt={image.alt}
                className="size-full object-cover"
                onError={() => setFailed((current) => ({ ...current, [index]: true }))}
                onLoad={(event) => {
                  const { naturalWidth, naturalHeight } = event.currentTarget;
                  if (naturalHeight)
                    setRatios((current) => ({ ...current, [index]: naturalWidth / naturalHeight }));
                }}
                src={replyImageSrc(reply.sessionId, image)}
              />
            )}
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
  return (
    <>
      {images.length === 1 ? (
        <SingleImage image={images[0]!} onOpen={() => setViewing(0)} />
      ) : (
        <ImageGallery images={images} onOpen={setViewing} />
      )}
      {viewing !== null && (
        <ReplyImageViewer
          images={images}
          index={viewing}
          onClose={() => setViewing(null)}
          onIndexChange={setViewing}
        />
      )}
    </>
  );
}
