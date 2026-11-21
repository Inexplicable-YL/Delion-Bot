import { BrowserWindow, type WebContents } from 'electron';
import { defineModule } from '../../app/module';
import { getAgentInstruction, setAgentInstruction } from '../../core/agent/instruction';
import { hostPorts } from '../../core/ports';
import { implement } from '../../core/protocol/contract';
import { settingsContract } from './contract';
import { exportUserData } from './main/backup';
import { cacheSize, clearCaches } from './main/cache';
import {
  getKeybindingOverrides,
  getTaskNotificationPrefs,
  normalizeFontSize,
  resetKeybindingOverrides,
  savedFontSize,
  savedIcon,
  savedTheme,
  savedZoom,
  setKeybindingOverrides,
  setTaskNotificationPrefs,
  writeSetting,
} from './main/prefs';
import { openAtLogin, setOpenAtLogin, setTheme, setZoom } from './main/system';

export {
  readSetting,
  savedIcon,
  savedPendingInstall,
  savedTheme,
  savedZoom,
  setPendingInstall,
  writeSetting,
} from './main/prefs';
export { applyTheme } from './main/system';
export { settingsSearch } from './main/search';
export { notifyRunFinished } from './main/task-notify';

export const settingsModule = defineModule({
  id: 'settings',
  ipc: implement(settingsContract, {
    theme: savedTheme,
    setTheme,
    icon: savedIcon,
    setIcon: (icon) => {
      writeSetting('icon', icon);
      return icon;
    },
    zoom: savedZoom,
    setZoom,
    fontSize: savedFontSize,
    setFontSize: (value) => {
      const size = normalizeFontSize(value);
      writeSetting('font-size', String(size));
      return size;
    },
    openAtLogin,
    setOpenAtLogin,
    taskNotifications: getTaskNotificationPrefs,
    setTaskNotifications: setTaskNotificationPrefs,
    keybindings: getKeybindingOverrides,
    setKeybindings: setKeybindingOverrides,
    resetKeybindings: resetKeybindingOverrides,
    instruction: getAgentInstruction,
    setInstruction: setAgentInstruction,
    exportData: () => {
      const client = hostPorts().workspaceClient();
      return exportUserData(client && BrowserWindow.fromWebContents(client as WebContents));
    },
    cacheSize,
    clearCache: clearCaches,
  }),
});
