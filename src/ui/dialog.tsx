'use client';

import { cva, type VariantProps } from 'class-variance-authority';
import { XMarkIcon as X } from '@heroicons/react/24/outline';
import { AlertDialog as AlertDialogPrimitive, Dialog as DialogPrimitive } from 'radix-ui';
import type { ComponentProps, ReactNode } from 'react';
import { Button } from './button';
import { cn } from './cn';
import { useDialogFocus } from './use-dialog-focus';
import { IconButton } from './icon-button';
import { dialogOverlay, dialogPanel } from './motion';

const contentVariants = cva(dialogPanel, {
  variants: {
    size: { sm: 'max-w-sm', md: 'max-w-md', lg: 'max-w-lg', xl: 'max-w-2xl' },
  },
  defaultVariants: { size: 'md' },
});

const Dialog = DialogPrimitive.Root;

function DialogTrigger(props: ComponentProps<typeof DialogPrimitive.Trigger>) {
  return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />;
}

function DialogContent({
  className,
  size,
  onOpenAutoFocus,
  onCloseAutoFocus,
  ...props
}: ComponentProps<typeof DialogPrimitive.Content> & VariantProps<typeof contentVariants>) {
  const focus = useDialogFocus({ onOpenAutoFocus, onCloseAutoFocus });
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className={dialogOverlay} data-slot="dialog-overlay" />
      <DialogPrimitive.Content
        className={cn(contentVariants({ size }), className)}
        data-slot="dialog-content"
        aria-modal="true"
        {...focus}
        {...props}
      />
    </DialogPrimitive.Portal>
  );
}

function DialogHeader({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      className={cn('flex items-center justify-between gap-2', className)}
      data-slot="dialog-header"
      {...props}
    />
  );
}

function DialogTitle({ className, ...props }: ComponentProps<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      className={cn('text-ui-title-2', className)}
      data-slot="dialog-title"
      {...props}
    />
  );
}

function DialogDescription({
  className,
  ...props
}: ComponentProps<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description
      className={cn('mt-2 text-ui-callout text-ink-2', className)}
      data-slot="dialog-description"
      {...props}
    />
  );
}

function DialogFooter({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      className={cn('mt-4 flex flex-wrap justify-end gap-2', className)}
      data-slot="dialog-footer"
      {...props}
    />
  );
}

function DialogClose({
  'aria-label': label = '关闭',
  className,
  ...props
}: ComponentProps<typeof IconButton>) {
  return (
    <DialogPrimitive.Close asChild>
      <IconButton
        aria-label={label}
        className={className}
        data-slot="dialog-close"
        size="sm"
        {...props}
      >
        <X />
      </IconButton>
    </DialogPrimitive.Close>
  );
}

type ConfirmDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description: ReactNode;
  confirmLabel: ReactNode;
  onConfirm: () => void;
  destructive?: boolean;
  busy?: boolean;
};

/* AlertDialog 语义：点遮罩不会关闭。 */
function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  onConfirm,
  destructive,
  busy,
}: ConfirmDialogProps) {
  const focus = useDialogFocus();
  return (
    <AlertDialogPrimitive.Root onOpenChange={onOpenChange} open={open}>
      <AlertDialogPrimitive.Portal>
        <AlertDialogPrimitive.Overlay className={dialogOverlay} data-slot="dialog-overlay" />
        <AlertDialogPrimitive.Content
          className={contentVariants({ size: 'sm' })}
          data-slot="dialog-content"
          aria-modal="true"
          {...focus}
        >
          <AlertDialogPrimitive.Title className="text-ui-title-2" data-slot="dialog-title">
            {title}
          </AlertDialogPrimitive.Title>
          <AlertDialogPrimitive.Description
            className="mt-2 text-ui-callout text-ink-2"
            data-slot="dialog-description"
          >
            {description}
          </AlertDialogPrimitive.Description>
          <DialogFooter>
            <AlertDialogPrimitive.Cancel asChild>
              <Button disabled={busy} variant="secondary">
                取消
              </Button>
            </AlertDialogPrimitive.Cancel>
            <Button
              disabled={busy}
              onClick={onConfirm}
              variant={destructive ? 'destructive' : 'accent'}
            >
              {confirmLabel}
            </Button>
          </DialogFooter>
        </AlertDialogPrimitive.Content>
      </AlertDialogPrimitive.Portal>
    </AlertDialogPrimitive.Root>
  );
}

export {
  ConfirmDialog,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
};
