import { useState } from 'react';
import { cn } from './cn';

const MAX_ZOOM = 8;
const WHEEL_ZOOM_RATE = 0.002;

type Offset = { x: number; y: number };
type Drag = { id: number; pointer: Offset; origin: Offset };
type Geometry = { width: number; height: number; viewportWidth: number; viewportHeight: number };

const panRatio = (offset: number, limit: number) =>
  limit > 0 ? Math.max(-1, Math.min(1, offset / limit)) : 0;

function panLimits(geometry: Geometry | null, scale: number): Offset {
  if (!geometry) return { x: 0, y: 0 };
  return {
    x: Math.max(0, (geometry.width * scale - geometry.viewportWidth) / 2),
    y: Math.max(0, (geometry.height * scale - geometry.viewportHeight) / 2),
  };
}

export function ZoomableImage({
  src,
  alt,
  className,
  imageClassName,
  preview,
  minScale = 1,
  'data-backdrop': backdrop,
}: {
  src: string;
  alt: string;
  className?: string;
  imageClassName?: string;
  preview?: { url: string; width: number; height: number } | null;
  minScale?: number;
  'data-backdrop'?: boolean;
}) {
  const [{ scale, pan }, setView] = useState({ scale: 1, pan: { x: 0, y: 0 } });
  const [drag, setDrag] = useState<Drag | null>(null);
  const [geometry, setGeometry] = useState<Geometry | null>(null);
  const [thumbnailSettled, setThumbnailSettled] = useState(false);
  const [originalReady, setOriginalReady] = useState(false);
  const limit = panLimits(geometry, scale);
  const offset = { x: pan.x * limit.x, y: pan.y * limit.y };
  const pannable = limit.x > 0 || limit.y > 0;
  const measure = (image: HTMLImageElement) => {
    const area = image.parentElement!;
    const { offsetWidth: width, offsetHeight: height } = image;
    const { clientWidth: viewportWidth, clientHeight: viewportHeight } = area;
    setGeometry((current) =>
      current?.width === width &&
      current.height === height &&
      current.viewportWidth === viewportWidth &&
      current.viewportHeight === viewportHeight
        ? current
        : { width, height, viewportWidth, viewportHeight },
    );
  };
  const connectViewport = (area: HTMLDivElement | null) => {
    if (!area) return;
    const resize = new ResizeObserver(() => {
      const image = area.querySelector<HTMLImageElement>('img:not([aria-hidden])');
      if (image?.complete) measure(image);
    });
    resize.observe(area);
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      const factor = Math.exp(-event.deltaY * WHEEL_ZOOM_RATE);
      setView((current) => {
        const scale = Math.min(MAX_ZOOM, Math.max(minScale, current.scale * factor));
        const limit = panLimits(geometry, scale);
        return {
          scale,
          pan: { x: limit.x ? current.pan.x : 0, y: limit.y ? current.pan.y : 0 },
        };
      });
    };
    area.addEventListener('wheel', wheel, { passive: false });
    return () => {
      resize.disconnect();
      area.removeEventListener('wheel', wheel);
    };
  };
  const ratio = preview ? preview.width / preview.height : null;
  const frame = preview &&
    ratio && {
      width: `min(${preview.width}px, 100cqw, ${100 * ratio}cqh)`,
      height: `min(${preview.height}px, 100cqh, ${100 / ratio}cqw)`,
    };
  const imageClass = (visible: boolean) =>
    cn(
      'absolute inset-0 m-auto select-none object-contain',
      !visible && 'invisible',
      pannable && (drag ? 'touch-none cursor-grabbing' : 'touch-none cursor-grab'),
      !drag && 'transition-transform duration-fast ease-out-strong motion-reduce:transition-none',
      imageClassName,
    );
  const imageStyle = {
    ...frame,
    maxWidth: 'var(--zoom-image-max-width, 100cqw)',
    maxHeight: 'var(--zoom-image-max-height, 100cqh)',
    transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})`,
  };
  const showOriginal = !preview || originalReady;

  return (
    <div
      className={cn('relative overflow-hidden @container-size', className)}
      data-backdrop={backdrop}
      ref={connectViewport}
      onLostPointerCapture={() => setDrag(null)}
      onPointerCancel={() => setDrag(null)}
      onPointerDown={(event) => {
        if (!pannable || drag || event.button !== 0 || !(event.target instanceof HTMLImageElement))
          return;
        event.currentTarget.setPointerCapture(event.pointerId);
        setDrag({
          id: event.pointerId,
          pointer: { x: event.clientX, y: event.clientY },
          origin: offset,
        });
      }}
      onPointerMove={(event) => {
        if (drag?.id !== event.pointerId) return;
        setView((current) => ({
          ...current,
          pan: {
            x: panRatio(drag.origin.x + event.clientX - drag.pointer.x, limit.x),
            y: panRatio(drag.origin.y + event.clientY - drag.pointer.y, limit.y),
          },
        }));
      }}
      onPointerUp={(event) => {
        if (drag?.id === event.pointerId) setDrag(null);
      }}
    >
      {preview && !originalReady && (
        <img
          alt={alt}
          className={imageClass(true)}
          decoding="async"
          draggable={false}
          onError={() => setThumbnailSettled(true)}
          onLoad={(event) => {
            measure(event.currentTarget);
            setThumbnailSettled(true);
          }}
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
            if (!preview) measure(event.currentTarget);
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
