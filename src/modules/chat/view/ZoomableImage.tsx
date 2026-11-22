import { useState } from 'react';
import { cn } from '../../../ui/cn';
import type { ImagePreview } from '../contract';

const MAX_ZOOM = 8;
const WHEEL_ZOOM_RATE = 0.002;

type Offset = { x: number; y: number };
type Drag = { pointerX: number; pointerY: number; origin: Offset };
type View = { scale: number; offset: Offset; pannable: boolean };

function panLimits(image: HTMLImageElement, scale: number): Offset {
  const area = image.parentElement!;
  return {
    x: Math.max(0, (image.offsetWidth * scale - area.clientWidth) / 2),
    y: Math.max(0, (image.offsetHeight * scale - area.clientHeight) / 2),
  };
}

function clampOffset(image: HTMLImageElement, scale: number, offset: Offset): Offset {
  const limits = panLimits(image, scale);
  return {
    x: Math.min(limits.x, Math.max(-limits.x, offset.x)),
    y: Math.min(limits.y, Math.max(-limits.y, offset.y)),
  };
}

export function ZoomableImage({
  src,
  alt,
  className,
  preview,
}: {
  src: string;
  alt: string;
  className?: string;
  preview: ImagePreview | null;
}) {
  const [view, setView] = useState<View>({ scale: 1, offset: { x: 0, y: 0 }, pannable: false });
  const [drag, setDrag] = useState<Drag | null>(null);
  const [thumbnailSettled, setThumbnailSettled] = useState(false);
  const [originalReady, setOriginalReady] = useState(false);
  const ratio = preview ? preview.width / preview.height : null;
  const frame = preview &&
    ratio && {
      width: `min(${preview.width}px, 100cqw, ${100 * ratio}cqh)`,
      height: `min(${preview.height}px, 100cqh, ${100 / ratio}cqw)`,
    };
  const imageClass = (visible: boolean) =>
    cn(
      'absolute inset-0 m-auto max-h-full max-w-full select-none rounded-chip object-contain',
      !visible && 'invisible',
      view.pannable && (drag ? 'cursor-grabbing' : 'cursor-grab'),
      !drag && 'transition-transform duration-fast',
    );
  const imageStyle = {
    ...frame,
    transform: `translate(${view.offset.x}px, ${view.offset.y}px) scale(${view.scale})`,
  };
  const showOriginal = !preview || originalReady;

  return (
    <div
      className={cn('relative overflow-hidden @container-size', className)}
      data-backdrop
      onWheel={(event) => {
        const image = event.currentTarget.querySelector<HTMLImageElement>('img:not([aria-hidden])');
        if (!image) return;
        const factor = Math.exp(-event.deltaY * WHEEL_ZOOM_RATE);
        setView((current) => {
          const scale = Math.min(MAX_ZOOM, Math.max(1, current.scale * factor));
          const limits = panLimits(image, scale);
          return {
            scale,
            offset: clampOffset(image, scale, current.offset),
            pannable: limits.x > 0 || limits.y > 0,
          };
        });
      }}
      onLostPointerCapture={() => setDrag(null)}
      onPointerCancel={() => setDrag(null)}
      onPointerDown={(event) => {
        if (!view.pannable || event.button !== 0 || !(event.target instanceof HTMLImageElement))
          return;
        event.target.setPointerCapture(event.pointerId);
        setDrag({ pointerX: event.clientX, pointerY: event.clientY, origin: view.offset });
      }}
      onPointerMove={(event) => {
        if (!drag || !(event.target instanceof HTMLImageElement)) return;
        const image = event.target;
        const offset = {
          x: drag.origin.x + event.clientX - drag.pointerX,
          y: drag.origin.y + event.clientY - drag.pointerY,
        };
        setView((current) => ({ ...current, offset: clampOffset(image, current.scale, offset) }));
      }}
      onPointerUp={() => setDrag(null)}
    >
      {preview && !originalReady && (
        <img
          alt={alt}
          className={imageClass(true)}
          decoding="async"
          draggable={false}
          onError={() => setThumbnailSettled(true)}
          onLoad={() => setThumbnailSettled(true)}
          src={preview.url}
          style={imageStyle}
        />
      )}
      {(!preview || thumbnailSettled) && (
        <img
          alt={showOriginal ? alt : ''}
          aria-hidden={showOriginal ? undefined : true}
          className={imageClass(showOriginal)}
          decoding="async"
          draggable={false}
          onLoad={(event) => {
            if (preview)
              void event.currentTarget.decode().then(
                () => setOriginalReady(true),
                () => {},
              );
          }}
          src={src}
          style={imageStyle}
        />
      )}
    </div>
  );
}
