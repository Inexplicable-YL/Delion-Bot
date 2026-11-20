import type { DelionBotApi } from '../preload/api';

declare global {
  interface Window {
    delionBot?: DelionBotApi;
  }
}
