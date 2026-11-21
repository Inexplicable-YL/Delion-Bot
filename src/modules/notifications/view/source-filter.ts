import { create } from 'zustand';

interface SourceFilterState {
  hidden: readonly string[];
  toggleSource: (source: string, all: readonly string[]) => void;
}

export const useNotificationSourceFilter = create<SourceFilterState>()((set) => ({
  hidden: [],
  toggleSource: (source, all) =>
    set(({ hidden }) => {
      if (hidden.includes(source)) return { hidden: hidden.filter((value) => value !== source) };
      if (all.every((value) => value === source || hidden.includes(value))) return {};
      return { hidden: [...hidden, source] };
    }),
}));
