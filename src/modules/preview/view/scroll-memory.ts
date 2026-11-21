import { create } from 'zustand';

const usePreviewScroll = create<Record<string, number>>(() => ({}));

export const rememberPreviewScroll = (scrollKey: string, top: number) =>
  usePreviewScroll.setState({ [scrollKey]: top });

export const previewScrollOf = (scrollKey: string) => usePreviewScroll.getState()[scrollKey] ?? 0;
