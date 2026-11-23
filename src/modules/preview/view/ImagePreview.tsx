import { useState } from 'react';
import { ZoomableImage } from '../../../ui/ZoomableImage';

export function ImagePreview({
  bytes,
  mime,
  title,
}: {
  bytes: Uint8Array;
  mime?: string;
  title: string;
}) {
  const [src, setSrc] = useState<string | null>(null);
  const [attach] = useState(() => (viewport: HTMLDivElement | null) => {
    if (!viewport) return;
    const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: mime }));
    setSrc(url);
    return () => URL.revokeObjectURL(url);
  });

  return (
    <div ref={attach} className="flex min-h-0 min-w-0 flex-1">
      {src && (
        <ZoomableImage
          alt={title}
          className="min-h-0 min-w-0 flex-1"
          imageClassName="image-preview-fit rounded-image-preview shadow-image-preview"
          minScale={0.25}
          src={src}
        />
      )}
    </div>
  );
}
