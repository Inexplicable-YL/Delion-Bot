import { contextBridge, webUtils } from 'electron';
import { version } from '../../../package.json';
import type { DelionBotApi } from './api';
import { bridge } from './bridge';
import { windowApi } from './window';

contextBridge.exposeInMainWorld('delionBot', {
  platform: process.platform,
  pathForFile: (file: File) => webUtils.getPathForFile(file),
  bridge,
  version,
  updatedOnLaunch: process.argv.includes('--delion-updated'),
  window: windowApi,
} satisfies DelionBotApi);
