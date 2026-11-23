import { create } from 'zustand';
import type { DocumentMode } from '../../../ui/DocumentToolbar';

export const useNoteViewMemory = create<{
  modes: Record<string, DocumentMode>;
  scrolls: Record<string, number>;
}>(() => ({ modes: {}, scrolls: {} }));

export const rememberNoteMode = (entryId: string, mode: DocumentMode) =>
  useNoteViewMemory.setState((state) => ({ modes: { ...state.modes, [entryId]: mode } }));

export const rememberNoteScroll = (scrollKey: string, top: number) =>
  useNoteViewMemory.setState((state) => ({ scrolls: { ...state.scrolls, [scrollKey]: top } }));

export const noteScrollOf = (scrollKey: string) =>
  useNoteViewMemory.getState().scrolls[scrollKey] ?? 0;
