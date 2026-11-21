export type RemoteSetupStep =
  'probe' | 'upload' | 'verify' | 'start' | 'tunnel' | 'handshake' | 'ready';

export interface RemoteSetupProgress {
  step: RemoteSetupStep;
  detail?: string;
  ok?: boolean;
  bytes?: { sent: number; total: number };
}

export type RemoteChannelStatus = 'connecting' | 'ready' | 'reconnecting' | 'unavailable';

export interface RemoteChannelState {
  destination: string;
  state: RemoteChannelStatus;
  reason: string;
  since: number;
}

export interface RemoteTask {
  id: string;
  command: string;
  cwd: string;
  pid: number;
  state: 'running' | 'exited' | 'cancelled' | 'timeout';
  exitCode: number;
  signal?: string;
  startedAt: number;
  durationMs: number;
  output: number;
}
