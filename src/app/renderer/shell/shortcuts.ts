import { create } from 'zustand';
import {
  defaultKeybindings,
  mergeKeybindings,
  type KeybindingMap,
  type ShortcutActionId,
} from '../../../modules/settings/contract';
import { settingsClient } from '../../../modules/settings/view';

type Store = {
  bindings: KeybindingMap;
  load: () => Promise<void>;
  setBinding: (id: ShortcutActionId, accelerator: string | null) => Promise<void>;
  resetAll: () => Promise<void>;
};

export const useShortcuts = create<Store>((set) => ({
  bindings: defaultKeybindings(),

  load: async () => {
    if (!window.delionBot) return;
    try {
      set({ bindings: mergeKeybindings(await settingsClient.keybindings()) });
    } catch {}
  },

  setBinding: async (id, accelerator) => {
    if (!window.delionBot) return;
    set({ bindings: mergeKeybindings(await settingsClient.setKeybindings({ [id]: accelerator })) });
  },

  resetAll: async () => {
    if (!window.delionBot) return;
    set({ bindings: mergeKeybindings(await settingsClient.resetKeybindings()) });
  },
}));
