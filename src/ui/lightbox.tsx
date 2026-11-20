import { XMarkIcon } from '@heroicons/react/24/outline';
import { Dialog } from 'radix-ui';
import { createRoot, type Root } from 'react-dom/client';
import { IconButton } from './icon-button';
import { overlayFade } from './motion';

function Lightbox({ src, alt, opener }: { src: string; alt?: string; opener: HTMLElement | null }) {
  return (
    <Dialog.Root open onOpenChange={(open) => !open && closeLightbox()}>
      <Dialog.Portal>
        <Dialog.Overlay className={`fixed inset-0 z-scrim bg-media/80 ${overlayFade}`} />
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
              className="glass-clear absolute right-app top-app rounded-full text-on-media hover:text-on-media"
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

/** React 树外的图片点击也走同一个 Lightbox；重复调用只更新内容，不叠层。 */
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
