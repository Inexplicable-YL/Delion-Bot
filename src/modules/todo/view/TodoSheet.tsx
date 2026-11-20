import type { ReactNode } from 'react';
import { XMarkIcon } from '@heroicons/react/24/outline';
import { Button } from '../../../ui/button';
import { useMediaQuery } from '../../../ui/use-media-query';
import { Sheet, SheetContent } from '../../../ui/sheet';

export function TodoSheet({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const narrow = useMediaQuery('(width < 48rem)');
  return (
    <Sheet open onOpenChange={(open) => !open && onClose()}>
      <SheetContent
        className={`overflow-y-auto p-card-ui ${narrow ? 'max-h-dialog' : ''}`}
        side={narrow ? 'bottom' : 'right'}
        title={title}
      >
        <div className="flex items-start justify-between gap-app-gap">
          <h2 className="min-w-0 wrap-anywhere text-ui-title-2" aria-hidden>
            {title}
          </h2>
          <Button aria-label="关闭" onClick={onClose} size="icon-sm" variant="ghost">
            <XMarkIcon />
          </Button>
        </div>
        {children}
      </SheetContent>
    </Sheet>
  );
}
