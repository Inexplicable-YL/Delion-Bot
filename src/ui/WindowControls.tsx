import {
  MinusIcon as Minus,
  Square2StackIcon as Restore,
  StopIcon as Maximize,
  XMarkIcon as X,
} from '@heroicons/react/24/outline';
import { cn } from './cn';
import { WindowControlButton } from './WindowControlButton';

export function WindowControls({
  maximized,
  onMinimize,
  onToggleMaximize,
  onClose,
  className,
}: {
  maximized: boolean;
  onMinimize: () => void;
  onToggleMaximize: () => void;
  onClose: () => void;
  className?: string;
}) {
  return (
    <div className={cn('desktop-no-drag flex h-full items-center gap-2', className)}>
      <WindowControlButton aria-label="最小化" onClick={onMinimize}>
        <Minus className="size-4" />
      </WindowControlButton>
      <WindowControlButton aria-label={maximized ? '还原' : '最大化'} onClick={onToggleMaximize}>
        {maximized ? <Restore className="-scale-x-100" /> : <Maximize />}
      </WindowControlButton>
      <WindowControlButton aria-label="关闭" close onClick={onClose}>
        <X className="size-4" />
      </WindowControlButton>
    </div>
  );
}
