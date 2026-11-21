import { z } from 'zod';
import { defineContract } from '../../core/protocol/contract';

export type UpdateReason =
  | 'not-packaged'
  | 'platform-unsupported'
  | 'feed-not-configured'
  | 'feed-unavailable'
  | 'invalid-update'
  | 'cancelled'
  | 'failed';

export type UpdatePhase =
  | 'idle'
  | 'checking'
  | 'up-to-date'
  | 'available'
  | 'downloading'
  | 'ready'
  | 'installing'
  | 'unsupported'
  | 'error';

export type UpdateStep = 'check' | 'download' | 'install';

export interface UpdateSnapshot {
  phase: UpdatePhase;
  currentVersion: string;
  version: string | null;
  progress: number;
  transferred: number;
  total: number | null;
  checkedAt: string | null;
  reason: UpdateReason | null;
  detail: string | null;
  failedAt: UpdateStep | null;
}

const snapshot = z.custom<UpdateSnapshot>();

export const updateContract = defineContract(
  'update',
  {
    state: { input: z.undefined(), output: snapshot },
    check: { input: z.undefined(), output: snapshot },
    download: { input: z.undefined(), output: snapshot },
    install: { input: z.undefined(), output: snapshot },
    deferInstall: { input: z.undefined(), output: z.void() },
  },
  { state: snapshot },
);
