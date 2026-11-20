import type { ReactNode } from 'react';

type SectionHeaderProps = {
  action?: ReactNode;
  description?: string;
  title: string;
};

export function SectionHeader({ action, description, title }: SectionHeaderProps) {
  return (
    <header className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
      <div className="grid gap-1.5">
        <h1 className="text-ui-large-title text-ink">{title}</h1>
        {description && <p className="max-w-measure text-ui-body text-ink-2">{description}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </header>
  );
}
