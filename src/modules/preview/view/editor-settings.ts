import { create } from 'zustand';

export const useEditorSettings = create<{
  wordWrap: boolean;
  toggleWordWrap: () => void;
}>((set) => ({
  wordWrap: false,
  toggleWordWrap: () => set((state) => ({ wordWrap: !state.wordWrap })),
}));
