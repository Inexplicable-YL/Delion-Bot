import { queryOptions, useQuery, type QueryClient } from '@tanstack/react-query';
import { create } from 'zustand';
import type { RemoteChannelState, RemoteSetupProgress, SshConfigHost } from '../contract';
import { onRemotesEvent, remotesClient } from './client';

interface RemoteState {
  pushedChannels: Record<string, RemoteChannelState> | null;
  homes: Record<string, string>;
  setupLog: RemoteSetupProgress[];
  setHome: (destination: string, home: string) => void;
  clearSetupLog: () => void;
}

const byDestination = (states: RemoteChannelState[]) =>
  Object.fromEntries(states.map((state) => [state.destination, state]));

export const useRemoteState = create<RemoteState>((set, get) => ({
  pushedChannels: null,
  homes: {},
  setupLog: [],
  setHome(destination, home) {
    if (get().homes[destination] !== home) set({ homes: { ...get().homes, [destination]: home } });
  },
  clearSetupLog() {
    set({ setupLog: [] });
  },
}));

onRemotesEvent('helperState', (states) =>
  useRemoteState.setState({ pushedChannels: byDestination(states) }),
);
onRemotesEvent('setupProgress', (progress) =>
  useRemoteState.setState((state) => ({ setupLog: [...state.setupLog, progress] })),
);

export const remoteConnectionsQuery = queryOptions({
  queryKey: ['remotes', 'list'],
  queryFn: () => remotesClient.list(),
});

export const sshConfigHostsQuery = queryOptions({
  queryKey: ['remotes', 'configHosts'],
  queryFn: () => remotesClient.configHosts().catch(() => [] as SshConfigHost[]),
});

const helperStatesQuery = queryOptions({
  queryKey: ['remotes', 'helperStates'],
  queryFn: () => remotesClient.helperStates(),
  select: byDestination,
});

const noChannels: Record<string, RemoteChannelState> = {};

export function useRemoteChannels(enabled = true): Record<string, RemoteChannelState> {
  const snapshot = useQuery({ ...helperStatesQuery, enabled });
  const pushed = useRemoteState((state) => state.pushedChannels);
  return pushed ?? snapshot.data ?? noChannels;
}

export function refreshRemoteConnections(client: QueryClient) {
  return Promise.all([
    client.invalidateQueries({ queryKey: remoteConnectionsQuery.queryKey }),
    client.invalidateQueries({ queryKey: sshConfigHostsQuery.queryKey }),
  ]);
}

export function channelDot(state: RemoteChannelState | undefined): {
  className: string;
  label: string;
} {
  switch (state?.state) {
    case 'ready':
      return { className: 'bg-success', label: '可用' };
    case 'connecting':
      return { className: 'bg-warning animate-pulse motion-reduce:animate-none', label: '连接中' };
    case 'reconnecting':
      return { className: 'bg-warning animate-pulse motion-reduce:animate-none', label: '重连中' };
    case 'unavailable':
      return { className: 'bg-danger', label: '不可用' };
    default:
      return { className: 'bg-ink-3/50', label: '未连接' };
  }
}
