import { XMarkIcon } from '@heroicons/react/24/outline';
import { Dialog } from 'radix-ui';
import { createRoot, type Root } from 'react-dom/client';
import { IconButton } from './IconButton';
import { overlayFade } from './motion';

function Lightbox({ src, alt, opener }: { src: string; alt?: string; opener: HTMLElement | null }) {
  return (
    <Dialog.Root open onOpenChange={(open) => !open && closeLightbox()}>
      <Dialog.Portal>
        <Dialog.Overlay className={`fixed inset-0 z-scrim bg-page/95 ${overlayFade}`} />
        <Dialog.Content
          aria-describedby={undefined}
          aria-modal="true"
          className="fixed inset-0 z-overlay grid place-items-center p-app"
          onCloseAutoFocus={(event) => {
            if (!opener?.isConnected) return;
            event.preventDefault();
            opener.focus({ preventScroll: true });
          }}
        >
          <Dialog.Title className="sr-only">图片查看</Dialog.Title>
          <img
            alt={alt ?? ''}
            className="max-h-full max-w-full rounded-card object-contain"
            src={src}
          />
          <Dialog.Close asChild>
            <IconButton
              aria-label="关闭图片"
              className="absolute right-app top-app rounded-full bg-surface ring-1 ring-inset ring-line hover:bg-hover-strong"
              size="lg"
            >
              <XMarkIcon />
            </IconButton>
          </Dialog.Close>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

let mounted: { root: Root } | null = null;

export function openLightbox(src: string, alt?: string): void {
  if (!mounted) {
    const host = document.createElement('div');
    document.body.append(host);
    mounted = { root: createRoot(host) };
  }
  const active = document.activeElement;
  mounted.root.render(
    <Lightbox alt={alt} opener={active instanceof HTMLElement ? active : null} src={src} />,
  );
}

function closeLightbox(): void {
  mounted?.root.render(null);
}
