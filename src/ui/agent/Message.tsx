'use client';

import { useState, type ComponentProps, type ReactNode } from 'react';
import {
  ArchiveBoxIcon as Archive,
  ArrowUpIcon as ArrowUp,
  ArrowUturnLeftIcon as RotateCcw,
  CheckIcon as Check,
  CubeIcon as Package,
  DocumentDuplicateIcon as Copy,
  ExclamationCircleIcon as CircleAlert,
  XMarkIcon as X,
} from '@heroicons/react/24/outline';
import { Button } from '../Button';
import { Card } from '../Card';
import { cn } from '../cn';
import { IconButton } from '../IconButton';
import { Shimmer } from '../Shimmer';

const COPY_FEEDBACK_MS = 1500;

export function UserMessage({ children }: { children: ReactNode }) {
  return <div className="group/message mb-5 flex flex-col items-end">{children}</div>;
}

export function UserBubble({ children }: { children: ReactNode }) {
  return (
    <div
      data-user-bubble
      className="max-w-message rounded-card bg-field px-3.5 py-2 text-ui-chat-body text-ink shadow-hairline wrap-anywhere"
    >
      {children}
    </div>
  );
}

export function MessageChips({ children }: { children: ReactNode }) {
  return <div className="mt-1.5 flex max-w-message flex-wrap justify-end gap-1.5">{children}</div>;
}

export function MessageChip({
  icon,
  title,
  onClick,
  children,
}: {
  icon?: ReactNode;
  title?: string;
  onClick?: () => void;
  children: ReactNode;
}) {
  const className =
    'flex h-7 min-w-0 max-w-full items-center gap-1.5 rounded-control bg-field px-2 text-ui-subhead text-ink-2 shadow-hairline';
  const content = (
    <>
      {icon}
      <span className="truncate">{children}</span>
    </>
  );
  return onClick ? (
    <button
      className={cn(className, 'transition-colors hover:bg-hover-strong hover:text-ink')}
      onClick={onClick}
      title={title}
      type="button"
    >
      {content}
    </button>
  ) : (
    <span className={className} title={title}>
      {content}
    </span>
  );
}

export function MessageComments({ comments }: { comments: { quote: string; comment?: string }[] }) {
  return (
    <div className="mb-1.5 grid max-w-message justify-items-end gap-1">
      {comments.map(({ quote, comment }, index) => (
        <div
          className="grid min-w-0 max-w-full gap-0.5 rounded-card bg-inset px-3 py-1.5 text-ui-subhead shadow-hairline wrap-anywhere"
          key={index}
        >
          <blockquote className="line-clamp-3 whitespace-pre-wrap border-l-2 border-line-strong pl-2 text-ink-2">
            {quote}
          </blockquote>
          {comment && <p className="whitespace-pre-wrap text-ink-2">{comment}</p>}
        </div>
      ))}
    </div>
  );
}

export function UserMessageEditor({
  value,
  onChange,
  onSubmit,
  onCancel,
  submitDisabled,
  children,
}: {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
  submitDisabled: boolean;
  children?: ReactNode;
}) {
  return (
    <div className="mb-5 flex flex-col items-end">
      <textarea
        autoFocus
        className="max-h-64 w-full max-w-message resize-none rounded-card border border-line border-line-strong bg-surface px-3.5 py-2 text-ui-body text-ink shadow-card outline-none [field-sizing:content]"
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing) return;
          if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            onSubmit();
          }
          if (event.key === 'Escape') onCancel();
        }}
        rows={2}
        value={value}
      />
      <div className="mt-1.5 flex items-center gap-1">
        <IconButton aria-label="取消编辑" onClick={onCancel} title="取消">
          <X />
        </IconButton>
        <Button
          aria-label="重新发送"
          className="rounded-full"
          disabled={submitDisabled}
          onClick={onSubmit}
          size="icon-xs"
          title="重新发送"
        >
          <ArrowUp />
        </Button>
      </div>
      {children}
    </div>
  );
}

export function AssistantMessage({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      className={cn('group/message mb-8 min-w-0 text-ui-body wrap-anywhere', className)}
      {...props}
    />
  );
}

export function MessageActions({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        'mt-0.5 flex items-center gap-0.5 opacity-0 transition-opacity group-focus-within/message:opacity-100 group-hover/message:opacity-100',
        className,
      )}
    >
      {children}
    </div>
  );
}

export function CopyAction({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <IconButton
      aria-label={label}
      onClick={() => {
        void navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), COPY_FEEDBACK_MS);
      }}
      title="复制"
    >
      {copied ? <Check className="text-success" /> : <Copy />}
    </IconButton>
  );
}

export function ErrorCard({ reason, onRetry }: { reason: string; onRetry?: () => void }) {
  return (
    <div
      role="alert"
      className="my-3 flex items-start gap-2 rounded-card bg-danger-tint px-3 py-2 text-ui-body text-ink"
    >
      <CircleAlert aria-hidden className="mt-1 size-4 shrink-0 text-danger" />
      <p className="min-w-0 flex-1 break-words">{reason}</p>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="-my-0.5 flex h-7 shrink-0 items-center gap-1 rounded-control px-2 text-ui-subhead text-ink-2 transition-colors hover:bg-surface hover:text-ink"
        >
          <RotateCcw aria-hidden className="size-4" />
          重试
        </button>
      )}
    </div>
  );
}

export function ExtensionMessage({
  customType,
  children,
}: {
  customType: string;
  children: ReactNode;
}) {
  return (
    <Card className="my-3 grid gap-1.5" variant="inset">
      <span className="flex items-center gap-1.5 text-ui-subhead text-ink-2">
        <Package aria-hidden className="size-4" />
        扩展 · {customType}
      </span>
      {children}
    </Card>
  );
}

export function CompactionDivider({
  pending = false,
  mode,
  releasedTokens,
  children,
}: {
  pending?: boolean;
  mode?: 'manual' | 'auto';
  releasedTokens?: number;
  children?: ReactNode;
}) {
  const [expanded, setExpanded] = useState(false);
  const label = [
    '上下文已压缩',
    mode && (mode === 'manual' ? '手动' : '自动'),
    releasedTokens !== undefined &&
      `${releasedTokens >= 1000 ? `${Number((releasedTokens / 1000).toFixed(1))}k` : releasedTokens} tokens 已释放`,
  ]
    .filter(Boolean)
    .join(' · ');
  const divider = (
    <>
      <span className="h-px flex-1 bg-line" />
      <Archive aria-hidden className="size-4 shrink-0" />
      {pending ? <Shimmer>正在压缩上下文</Shimmer> : <span className="text-center">{label}</span>}
      <span className="h-px flex-1 bg-line" />
    </>
  );
  const dividerClass = 'flex items-center gap-3 text-ui-subhead text-ink-2';
  return children && !pending ? (
    <details className="my-6" onToggle={(event) => setExpanded(event.currentTarget.open)}>
      <summary
        className={cn(
          dividerClass,
          'cursor-pointer list-none rounded-control hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-ink',
        )}
        data-trace-toggle=""
      >
        {divider}
      </summary>
      {expanded && <div className="mt-3 rounded-card bg-inset p-4">{children}</div>}
    </details>
  ) : (
    <div className={cn('my-6', dividerClass)} role="status">
      {divider}
    </div>
  );
}
