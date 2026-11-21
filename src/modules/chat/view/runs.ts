import { create } from 'zustand';
import { onAgentEvent } from './client';
import type { RunEvent, RunStatus } from '../../../core/protocol/agent';

export interface RunMirror {
  runId: string;
  status: RunStatus;
}

function applyRunEvent(
  bySession: Record<string, RunMirror>,
  event: RunEvent,
): Record<string, RunMirror> {
  return {
    ...bySession,
    [event.sessionId]: {
      runId: event.runId,
      status: event.status,
    },
  };
}

export function runBadge(status: RunStatus): 'running' | 'failed' | 'completed' | null {
  if (status === 'pending' || status === 'running') return 'running';
  if (status === 'completed' || status === 'failed') return status;
  return null;
}

interface RunsState {
  bySession: Record<string, RunMirror>;
  viewing: Record<string, number>;
  apply: (event: RunEvent) => void;
  startViewing: (sessionId: string) => void;
  stopViewing: (sessionId: string) => void;
  markSeen: (sessionId: string) => void;
}

function isSettled(status: RunStatus): boolean {
  const badge = runBadge(status);
  return badge !== null && badge !== 'running';
}

export const useRuns = create<RunsState>((set, get) => ({
  bySession: {},
  viewing: {},
  apply: (event) => {
    set((state) => ({ bySession: applyRunEvent(state.bySession, event) }));
    if (isSettled(event.status) && isSessionViewed(event.sessionId))
      get().markSeen(event.sessionId);
  },
  startViewing: (sessionId) => {
    set((state) => ({
      viewing: { ...state.viewing, [sessionId]: (state.viewing[sessionId] ?? 0) + 1 },
    }));
    const run = get().bySession[sessionId];
    if (run && isSettled(run.status)) get().markSeen(sessionId);
  },
  stopViewing: (sessionId) =>
    set((state) => ({
      viewing: { ...state.viewing, [sessionId]: (state.viewing[sessionId] ?? 1) - 1 },
    })),
  markSeen: (sessionId) =>
    set((state) => {
      const run = state.bySession[sessionId];
      if (!run || runBadge(run.status) === 'running') return state;
      const bySession = { ...state.bySession };
      delete bySession[sessionId];
      return { bySession };
    }),
}));

export function isSessionViewed(sessionId: string): boolean {
  return (useRuns.getState().viewing[sessionId] ?? 0) > 0;
}

export function useSessionRunStatus(sessionId: string): RunStatus | null {
  return useRuns((state) => state.bySession[sessionId]?.status ?? null);
}

onAgentEvent('run-event', useRuns.getState().apply);
