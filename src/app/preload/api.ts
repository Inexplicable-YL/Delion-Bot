import type { Bridge } from '../../core/protocol/contract';

export interface DelionBotApi {
  readonly bridge: Bridge;
  readonly platform: string;
  pathForFile(file: File): string;
  readonly version: string;
  readonly updatedOnLaunch: boolean;
  readonly window: WindowApi;
}

export interface WindowState {
  readonly maximized: boolean;
}

export type TrayAction = 'new-chat' | 'new-project' | 'open-settings';

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
