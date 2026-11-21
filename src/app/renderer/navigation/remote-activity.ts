import { create } from 'zustand';

export type RemotePhase = 'connecting' | 'ready' | 'failed';

export interface RemoteActivity {
  phase: RemotePhase;
  reason?: string;
}

type Store = {
  byProject: Record<string, RemoteActivity>;
  setPhase: (projectId: string, phase: RemotePhase, reason?: string) => void;
};

export const useRemoteActivity = create<Store>((set) => ({
  byProject: {},
  setPhase: (projectId, phase, reason) =>
    set((state) => {
      const prev = state.byProject[projectId];
      if (prev?.phase === phase && prev.reason === reason) return state;
      return { byProject: { ...state.byProject, [projectId]: { phase, reason } } };
    }),
}));
