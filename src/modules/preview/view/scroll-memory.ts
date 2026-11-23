import { create } from 'zustand';
import type { DocumentMode } from '../../../ui/DocumentToolbar';

const usePreviewScroll = create<Record<string, number>>(() => ({}));

export const rememberPreviewScroll = (scrollKey: string, top: number) =>
  usePreviewScroll.setState({ [scrollKey]: top });

export const previewScrollOf = (scrollKey: string) => usePreviewScroll.getState()[scrollKey] ?? 0;

export const useHtmlPreviewModes = create<Record<string, DocumentMode>>(() => ({}));
