'use client';

import {
  CheckCircleIcon as CircleCheck,
  ExclamationCircleIcon as CircleAlert,
  InformationCircleIcon as Info,
  XMarkIcon as X,
} from '@heroicons/react/24/outline';
import type { OutlineIcon } from './outline-icon';
import { Toast } from 'radix-ui';
import { useSyncExternalStore, type ReactNode } from 'react';
import { cn } from './cn';
import { IconButton } from './icon-button';

export type ToastVariant = 'error' | 'success';

const tone = {
  error: { icon: CircleAlert, color: 'text-danger', role: 'alert' },
  success: { icon: CircleCheck, color: 'text-success', role: 'status' },
  neutral: { icon: Info, color: 'text-ink-2', role: 'group' },
} as const;

export function ToastCard({
  variant,
  title,
  description,
  onClose,
  className,
  icon,
  action,
  children,
}: {
  variant: ToastVariant | 'neutral';
  title: string;
  description?: string;
  onClose?: () => void;
  className?: string;
  icon?: OutlineIcon;
  action?: ReactNode;
  children?: ReactNode;
}) {
  const { color, role } = tone[variant];
  const Icon = icon ?? tone[variant].icon;
  return (
    <div
      role={role}
      aria-label={variant === 'neutral' ? title : undefined}
      className={cn(
        `pointer-events-auto flex w-96 max-w-full items-start gap-2.5 rounded-full glass-thick py-3 pl-4 pr-3`,
        className,
      )}
    >
      <span className={cn('flex size-7 shrink-0 items-center justify-center', color)}>
        <Icon aria-hidden className="size-4" />
      </span>
      <div className="min-w-0 flex-1 pt-0.5">
        <p className="text-ui-headline text-ink">{title}</p>
        {description && (
          <p className="mt-0.5 break-words text-ui-subhead text-ink-2">{description}</p>
        )}
        {children}
      </div>
      {action}
      {onClose && (
        <IconButton aria-label="关闭通知" onClick={onClose} className="-mt-0.5">
          <X />
        </IconButton>
      )}
    </div>
  );
}

export interface ToastItem {
  id: string;
  open: boolean;
  variant: ToastVariant | 'neutral';
  title: string;
  description?: string;
}

const MAX_OPEN_TOASTS = 3;
const TOAST_DURATION_MS = 5000;

let items: ToastItem[] = [];
const listeners = new Set<() => void>();

function setItems(next: ToastItem[]) {
  items = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** 瞬时动作结果由任意模块直接调用；持久状态仍内联展示。 */
export function showToast(toast: Omit<ToastItem, 'id' | 'open'>) {
  const opened = items.filter((item) => item.open);
  setItems([...opened, { id: crypto.randomUUID(), open: true, ...toast }].slice(-MAX_OPEN_TOASTS));
}

export function dismissToast(id: string) {
  setItems(items.map((item) => (item.id === id ? { ...item, open: false } : item)));
}

export function toasts() {
  return items.filter((item) => item.open);
}

export function Toaster() {
  const current = useSyncExternalStore(subscribe, () => items);
  return (
    <Toast.Provider>
      {current.map((toast) => (
        <Toast.Root
          key={toast.id}
          open={toast.open}
          duration={TOAST_DURATION_MS}
          onOpenChange={(open) => {
            if (!open) dismissToast(toast.id);
          }}
          className="data-[state=closed]:animate-toast-out data-[state=open]:animate-toast-in motion-reduce:animate-none"
        >
          <ToastCard
            variant={toast.variant}
            title={toast.title}
            description={toast.description}
            onClose={() => dismissToast(toast.id)}
          />
        </Toast.Root>
      ))}
      <Toast.Viewport
        data-toast-host=""
        className="pointer-events-none fixed inset-x-0 bottom-app-inset z-toast max-md:bottom-toast-mobile flex flex-col items-center gap-2 px-app pb-3"
      />
    </Toast.Provider>
  );
}
