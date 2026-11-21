import { useState, type ReactNode } from 'react';
import type { OutlineIcon } from '../outline-icon';
import { Button } from '../Button';
import { Card } from '../Card';
import { Collapse, CollapseChevron } from '../Collapse';
import { IconButton } from '../IconButton';

export function TaskNotice({
  icon: Icon,
  title,
  failed = false,
  label,
  duration,
  onOpenSession,
  children,
}: {
  icon: OutlineIcon;
  title: string;
  failed?: boolean;
  label: string;
  duration: string;
  onOpenSession?: () => void;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Card className="my-3" variant="inset">
      <div className="flex min-w-0 items-center gap-1.5 text-ui-subhead text-ink-2">
        <Icon aria-hidden className="size-3.5 shrink-0" strokeWidth={1.8} />
        <span className={`shrink-0 font-medium ${failed ? 'text-danger' : ''}`}>{title}</span>
        <span className="min-w-0 flex-1 truncate" title={label}>
          {label}
        </span>
        <span className="shrink-0 tabular-nums">{duration}</span>
        {onOpenSession && (
          <Button size="sm" variant="ghost" onClick={onOpenSession}>
            打开子会话
          </Button>
        )}
        <IconButton
          aria-expanded={open}
          aria-label={open ? '收起通知' : '展开通知'}
          className="size-6"
          onClick={() => setOpen((value) => !value)}
        >
          <CollapseChevron open={open} />
        </IconButton>
      </div>
      <Collapse open={open}>{children}</Collapse>
    </Card>
  );
}

export function SubagentCard({
  prompt,
  reply,
  footer,
}: {
  prompt?: string;
  reply?: ReactNode;
  footer?: { text: string; onOpen: () => void };
}) {
  return (
    <div className="mb-1 mt-1 grid min-w-0 gap-1.5">
      {prompt && (
        <p className="line-clamp-3 whitespace-pre-wrap break-words text-ui-subhead text-ink-2">
          {prompt}
        </p>
      )}
      {reply && (
        <div className="max-h-80 overflow-y-auto rounded-card border border-line px-3 py-2 text-ui-body">
          {reply}
        </div>
      )}
      {footer && (
        <div className="flex items-center gap-2 text-ui-subhead text-ink-2">
          <span>{footer.text}</span>
          <Button size="sm" variant="ghost" onClick={footer.onOpen}>
            打开子会话
          </Button>
        </div>
      )}
    </div>
  );
}
