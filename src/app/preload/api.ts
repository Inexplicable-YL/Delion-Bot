import type { Bridge } from '../../core/protocol/contract';

export interface DelionBotApi {
  readonly bridge: Bridge;
  readonly platform: string;
  pathForFile(file: File): string;
  readonly version: string;
  readonly updatedOnLaunch: boolean;
  readonly window: WindowApi;
  readonly trayMenu: TrayMenuApi;
}

export interface WindowState {
  readonly maximized: boolean;
}

export type TrayAction = 'new-chat' | 'new-project' | 'open-settings';

export type TrayMenuAction = 'open' | 'new-chat' | 'new-project' | 'quit';

export interface TrayMenuApi {
  select(action: TrayMenuAction): void;
  dismiss(): void;
  resize(size: { width: number; height: number; inset: number }): void;
}

export interface WindowApi {
  minimize(): void;
  toggleMaximize(): void;
  close(): void;
  quit(): void;
  getState(): Promise<WindowState>;
  contentReady(): void;
  onStateChange(listener: (state: WindowState) => void): () => void;
  onTrayAction(listener: (action: TrayAction) => void): () => void;
}
