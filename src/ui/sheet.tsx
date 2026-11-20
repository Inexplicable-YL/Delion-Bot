import type { ComponentProps, ReactNode } from 'react';
import { Dialog } from 'radix-ui';
import { cn } from './cn';
import { useDialogFocus } from './use-dialog-focus';

export const Sheet = Dialog.Root;
export const SheetTrigger = Dialog.Trigger;

const placements = {
  left: 'inset-y-app-inset left-app-inset w-sidebar animate-drawer-left',
  right: 'inset-y-app-inset right-app-inset w-inspector animate-drawer-right',
  bottom: 'inset-x-app-inset bottom-app-inset mx-auto w-sheet-width max-w-reading animate-sheet-up',
};

export function SheetContent({
  title,
  children,
  className,
  side = 'left',
  onOpenAutoFocus,
  onCloseAutoFocus,
  ...props
}: ComponentProps<typeof Dialog.Content> & {
  title: string;
  children: ReactNode;
  side?: keyof typeof placements;
}) {
  const focus = useDialogFocus({ onOpenAutoFocus, onCloseAutoFocus });
  return (
    <Dialog.Portal>
      <Dialog.Overlay className="fixed inset-0 z-scrim bg-scrim animate-overlay-in" />
      <Dialog.Content
        aria-describedby={undefined}
        aria-modal="true"
        className={cn(
          'glass-thick fixed z-overlay flex max-w-sheet flex-col rounded-panel p-app-inset',
          placements[side],
          className,
        )}
        data-slot="sheet-content"
        {...focus}
        {...props}
      >
        <Dialog.Title className="sr-only">{title}</Dialog.Title>
        {children}
      </Dialog.Content>
    </Dialog.Portal>
  );
}
