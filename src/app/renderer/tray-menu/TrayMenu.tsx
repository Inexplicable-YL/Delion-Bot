import {
  FolderPlusIcon,
  PencilSquareIcon,
  PowerIcon,
  WindowIcon,
} from '@heroicons/react/24/outline';
import { Fragment, type ComponentType, type SVGProps } from 'react';
import { createRoot } from 'react-dom/client';
import type { TrayMenuAction } from '../../preload/api';
import { cn } from '../../../ui/cn';
import { menuItem } from '../../../ui/menu-styles';
import '../styles/globals.css';

const groups: {
  action: TrayMenuAction;
  label: string;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
}[][] = [
  [{ action: 'open', label: '打开主窗口', icon: WindowIcon }],
  [
    { action: 'new-chat', label: '新建对话', icon: PencilSquareIcon },
    { action: 'new-project', label: '新建项目', icon: FolderPlusIcon },
  ],
  [{ action: 'quit', label: '退出 Delion Bot', icon: PowerIcon }],
];

const colorScheme = window.matchMedia('(prefers-color-scheme: dark)');

function applyColorScheme(): void {
  document.documentElement.classList.toggle('dark', colorScheme.matches);
}

applyColorScheme();
colorScheme.addEventListener('change', applyColorScheme);

function dismiss(): void {
  window.delionBot?.trayMenu.dismiss();
}

function nextItemIndex(key: string, current: number, count: number): number | undefined {
  if (key === 'Home') return 0;
  if (key === 'End') return count - 1;
  if (key !== 'ArrowDown' && key !== 'ArrowUp') return undefined;
  const step = key === 'ArrowDown' ? 1 : -1;
  if (current === -1) return step === 1 ? 0 : count - 1;
  return (current + step + count) % count;
}

function attachKeyboard(): () => void {
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      dismiss();
      return;
    }
    const items = [...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')];
    const current = items.indexOf(document.activeElement as HTMLButtonElement);
    const next = nextItemIndex(event.key, current, items.length);
    if (next === undefined) return;
    event.preventDefault();
    items[next]?.focus();
  };
  document.addEventListener('keydown', onKeyDown);
  return () => document.removeEventListener('keydown', onKeyDown);
}

function attachResize(panel: HTMLDivElement): () => void {
  const report = () => {
    const rect = panel.getBoundingClientRect();
    const inset = Math.round(rect.left);
    window.delionBot?.trayMenu.resize({
      width: Math.ceil(rect.width + inset * 2),
      height: Math.ceil(rect.height + inset * 2),
      inset,
    });
  };
  report();
  const observer = new ResizeObserver(report);
  observer.observe(panel);
  return () => observer.disconnect();
}

function TrayMenu() {
  return (
    <div
      className="w-fit p-6"
      onClick={(event) => {
        if (event.target === event.currentTarget) dismiss();
      }}
      ref={() => attachKeyboard()}
    >
      <div
        aria-label="Delion Bot"
        className="min-w-44 rounded-card bg-surface p-1 text-ink shadow-raised"
        ref={(node) => {
          if (!node) return;
          return attachResize(node);
        }}
        role="menu"
      >
        {groups.map((group, groupIndex) => (
          <Fragment key={groupIndex}>
            {groupIndex > 0 ? <div className="-mx-1 my-1 h-px bg-line" role="separator" /> : null}
            {group.map((item) => (
              <button
                className={cn(menuItem, 'w-full focus:bg-hover')}
                key={item.action}
                onClick={() => window.delionBot?.trayMenu.select(item.action)}
                onPointerMove={(event) => event.currentTarget.focus()}
                role="menuitem"
                type="button"
              >
                <item.icon />
                {item.label}
              </button>
            ))}
          </Fragment>
        ))}
      </div>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<TrayMenu />);
