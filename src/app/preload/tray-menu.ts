import type { TrayMenuAction, TrayMenuApi } from './api';
import { send } from './lib';

export const trayMenuApi = {
  select: (action: TrayMenuAction) => send('tray-menu:select', action),
  dismiss: () => send('tray-menu:dismiss'),
  resize: (size: { width: number; height: number; inset: number }) =>
    send('tray-menu:resize', size),
} satisfies TrayMenuApi;
