import { useState } from 'react';
import { cn } from '../../../ui/cn';

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
}: {
  src: string;
  alt: string;
  className?: string;
}) {
  const [view, setView] = useState<View>({ scale: 1, offset: { x: 0, y: 0 }, pannable: false });
  const [drag, setDrag] = useState<Drag | null>(null);

  return (
    <div
      className={cn('relative overflow-hidden', className)}
      data-backdrop
      onWheel={(event) => {
        const image = event.currentTarget.querySelector('img')!;
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
    >
      <img
        alt={alt}
        className={cn(
          'absolute inset-0 m-auto max-h-full max-w-full select-none rounded-chip object-contain',
          view.pannable && (drag ? 'cursor-grabbing' : 'cursor-grab'),
          !drag && 'transition-transform duration-fast',
        )}
        draggable={false}
        onPointerCancel={() => setDrag(null)}
        onPointerDown={(event) => {
          if (!view.pannable || event.button !== 0) return;
          event.currentTarget.setPointerCapture(event.pointerId);
          setDrag({ pointerX: event.clientX, pointerY: event.clientY, origin: view.offset });
        }}
        onPointerMove={(event) => {
          if (!drag) return;
          const image = event.currentTarget;
          const offset = {
            x: drag.origin.x + event.clientX - drag.pointerX,
            y: drag.origin.y + event.clientY - drag.pointerY,
          };
          setView((current) => ({ ...current, offset: clampOffset(image, current.scale, offset) }));
        }}
        onPointerUp={() => setDrag(null)}
        src={src}
        style={{
          transform: `translate(${view.offset.x}px, ${view.offset.y}px) scale(${view.scale})`,
        }}
      />
    </div>
  );
}
