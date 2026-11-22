'use client';

import type { ComponentProps, ReactNode } from 'react';
import {
  ArrowUpIcon as ArrowUp,
  CheckIcon as Check,
  Cog6ToothIcon as Settings,
  ExclamationCircleIcon as CircleAlert,
  StopIcon as Square,
  XMarkIcon as X,
} from '@heroicons/react/24/outline';
import { Button } from '../Button';
import { cn } from '../cn';

const MENU_ROW_UNITS = 9;
const scrollRowIntoView = (node: HTMLLIElement | null) =>
  node?.scrollIntoView({ block: 'nearest' });

export function PromptInput({
  dragging = false,
  dropHint,
  material = 'solid',
  className,
  children,
  ...props
}: ComponentProps<'div'> & { dragging?: boolean; dropHint: string; material?: 'solid' | 'glass' }) {
  const radius = material === 'glass' ? 'rounded-window' : 'rounded-card';
  return (
    <div
      className={cn(
        '@container relative',
        radius,
        material === 'glass'
          ? 'glass outline-line-strong focus-within:outline-1'
          : cn(
              'border border-line bg-surface shadow-card transition-colors duration-base focus-within:border-line-strong',
              dragging && 'border-transparent',
            ),
        className,
      )}
      {...props}
    >
      {dragging && (
        <div
          className={cn(
            'pointer-events-none absolute inset-0 z-raised grid place-items-center border-2 border-dashed border-line-strong bg-page/80 text-ui-body text-ink-2',
            radius,
          )}
        >
          {dropHint}
        </div>
      )}
      {children}
    </div>
  );
}

export function PromptInputAttachments({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return <div className={cn('grid gap-1.5', className ?? 'px-3 pt-3')}>{children}</div>;
}

export function PromptInputToolbar({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      data-slot="prompt-input-toolbar"
      className={cn(
        'flex items-center gap-1',
        className ?? 'px-2.5 pb-2.5 pt-1 @max-[160px]:gap-0.5 @max-[160px]:px-1.5',
      )}
    >
      {children}
    </div>
  );
}

export function PromptInputTrigger({ className, ...props }: ComponentProps<'button'>) {
  return (
    <button
      className={cn(
        'flex h-7 min-w-0 shrink items-center gap-1 rounded-control px-1.5 text-ui-subhead text-ink-2 transition-colors duration-base hover:bg-hover hover:text-ink',
        className,
      )}
      type="button"
      {...props}
    />
  );
}

export function PromptInputSubmit({
  stoppable,
  sendable,
  sendTitle,
  onSend,
  onStop,
}: {
  stoppable: boolean;
  sendable: boolean;
  sendTitle: string;
  onSend: () => void;
  onStop: () => void;
}) {
  return stoppable ? (
    <Button aria-label="停止执行" onClick={onStop} title="停止执行" size="icon-lg">
      <Square />
    </Button>
  ) : (
    <Button
      aria-label="发送"
      disabled={!sendable}
      onClick={onSend}
      title={sendTitle}
      size="icon-lg"
      variant={sendable ? 'accent' : 'secondary'}
    >
      <ArrowUp />
    </Button>
  );
}

export function PromptInputMenu({
  activeIndex,
  itemCount,
  children,
  ...props
}: ComponentProps<'ul'> & { activeIndex: number; itemCount: number }) {
  return (
    <ul
      className="absolute bottom-full left-0 z-20 mb-2 max-h-64 w-full min-w-56 overflow-auto rounded-card bg-surface p-1 shadow-raised @max-[260px]:min-w-0"
      role="listbox"
      {...props}
    >
      <span
        aria-hidden
        className="pointer-events-none absolute inset-x-1 rounded-chip bg-hover"
        style={{
          top: `calc(var(--spacing) * ${activeIndex * MENU_ROW_UNITS + 1})`,
          height: `calc(var(--spacing) * ${MENU_ROW_UNITS})`,
          opacity: activeIndex < itemCount ? 1 : 0,
          transition:
            'top 220ms cubic-bezier(0.23,1,0.32,1), height 220ms cubic-bezier(0.23,1,0.32,1), opacity 150ms ease',
        }}
      />
      {children}
    </ul>
  );
}

export function PromptInputMenuItem({
  id,
  selected,
  icon,
  onHover,
  onSelect,
  children,
}: {
  id: string;
  selected: boolean;
  icon: ReactNode;
  onHover: () => void;
  onSelect: () => void;
  children: ReactNode;
}) {
  return (
    <li
      aria-selected={selected}
      className="relative z-10 flex h-9 w-full items-center gap-2.5 rounded-chip px-2 text-left"
      id={id}
      onClick={onSelect}
      onMouseDown={(event) => event.preventDefault()}
      onMouseEnter={onHover}
      ref={selected ? scrollRowIntoView : undefined}
      role="option"
    >
      {icon}
      {children}
    </li>
  );
}

export function PromptInputNotice({
  message,
  onDismiss,
}: {
  message: string;
  onDismiss?: () => void;
}) {
  return (
    <div
      className="absolute inset-x-0 bottom-full z-10 mb-2 flex items-start gap-2 rounded-card bg-surface  px-3 py-1.5 text-ui-body text-ink shadow-hairline"
      role="alert"
    >
      <CircleAlert aria-hidden className="mt-1 size-4 shrink-0 text-danger" />
      <p className="min-w-0 flex-1 break-words">{message}</p>
      {onDismiss && (
        <button
          aria-label="关闭提示"
          className="-mr-1 flex size-6 shrink-0 items-center justify-center rounded-chip text-ink-2 transition-colors hover:bg-surface hover:text-ink"
          onClick={onDismiss}
          type="button"
        >
          <X className="size-4" />
        </button>
      )}
    </div>
  );
}

export function PromptInputOption({
  active,
  className,
  ...props
}: ComponentProps<'button'> & { active: boolean }) {
  return (
    <button
      className={cn(
        'flex h-7.5 w-full items-center gap-1 rounded-chip px-2 text-left text-ui-body transition-colors',
        active ? 'bg-hover font-medium text-ink' : 'text-ink-2 hover:bg-hover hover:text-ink',
        className,
      )}
      type="button"
      {...props}
    />
  );
}

export function PromptInputOptionCheck() {
  return <Check className="ms-auto size-4 shrink-0 text-ink" />;
}

export function PromptInputSetup({
  message,
  actionLabel,
  onAction,
}: {
  message: string;
  actionLabel: string;
  onAction: () => void;
}) {
  return (
    <div className="grid gap-2 px-1.5 py-2">
      <p className="text-ui-subhead text-ink-2">{message}</p>
      <Button
        className="w-full justify-start [&_svg]:size-3.5"
        onClick={onAction}
        size="sm"
        variant="outline"
      >
        <Settings />
        {actionLabel}
      </Button>
    </div>
  );
}
