import type { OutlineIcon } from './outline-icon';
import type * as React from 'react';
import { cn } from './cn';

/** 加载中、出错不用它，分别用状态文字与 Callout。 */
function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
}: {
  icon?: OutlineIcon;
  title: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex min-w-0 flex-col items-center justify-center gap-2 p-6 text-center',
        className,
      )}
      data-slot="empty-state"
    >
      {Icon && <Icon aria-hidden="true" className="size-6 text-ink-2" />}
      <p className="text-ui-title-3 text-ink">{title}</p>
      {description && <p className="text-ui-subhead text-ink-2">{description}</p>}
      {action && <div className="mt-1 flex items-center gap-2">{action}</div>}
    </div>
  );
}

export { EmptyState };
