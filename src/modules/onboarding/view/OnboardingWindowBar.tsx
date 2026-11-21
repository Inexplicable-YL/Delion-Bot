import type { ReactNode } from 'react';
import { MinusIcon as Minus, XMarkIcon as X } from '@heroicons/react/24/outline';
import { WindowControlButton } from '../../../ui/WindowControlButton';

export function OnboardingWindowBar({ children }: { children?: ReactNode }) {
  return (
    <div className="relative z-10 flex h-toolbar shrink-0 items-center justify-end [-webkit-app-region:drag]">
      {children && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          {children}
        </div>
      )}
      <div className="flex h-full items-center gap-2 [-webkit-app-region:no-drag]">
        {window.delionBot && window.delionBot.platform !== 'darwin' && (
          <>
            <WindowControlButton
              aria-label="最小化"
              onClick={() => window.delionBot?.window.minimize()}
            >
              <Minus className="size-4" />
            </WindowControlButton>
            <WindowControlButton
              aria-label="关闭"
              close
              onClick={() => window.delionBot?.window.close()}
            >
              <X className="size-4" />
            </WindowControlButton>
          </>
        )}
      </div>
    </div>
  );
}
