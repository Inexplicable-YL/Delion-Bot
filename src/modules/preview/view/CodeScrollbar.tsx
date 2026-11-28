import type { CSSProperties, Ref } from 'react';
import { cn } from '../../../ui/cn';

export function CodeScrollbar({
  ref,
  label = '横向滚动代码',
  className,
  style,
}: {
  ref?: Ref<HTMLDivElement>;
  label?: string;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <div
      ref={ref}
      aria-label={label}
      className={cn('h-(--scrollbar-size) min-w-0 overflow-x-auto overflow-y-hidden', className)}
      data-code-scrollbar=""
      hidden
      role="region"
      style={style}
      tabIndex={0}
    >
      <div className="h-px" />
    </div>
  );
}
