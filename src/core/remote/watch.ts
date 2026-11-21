import { notifyRemoteChange } from './events';
import { helperSession, type HelperSession, type WatchEvent } from './helper';
import { targetKey, type RemoteTarget } from './transport';

export interface RemoteWatchInput {
  projectId: string;
  target: RemoteTarget;
  root: string;
  paths: string[];
}

interface WatchSet extends RemoteWatchInput {
  targetKey: string;
}

const RECONNECT_MIN_MS = 1_000;
const RECONNECT_MAX_MS = 30_000;

const desired = new Map<string, WatchSet>();
const streams = new Map<string, { target: RemoteTarget; controller: AbortController }>();

function setsOf(key: string): WatchSet[] {
  return [...desired.values()].filter((set) => set.targetKey === key);
}

function handleEvent(key: string, event: WatchEvent): void {
  if (event.type === 'change') {
    for (const path of event.paths) notifyRemoteChange(path);
    return;
  }
  const affected = event.id === '*' ? setsOf(key) : [desired.get(event.id)];
  for (const set of affected) if (set) notifyRemoteChange(set.root);
}

async function apply(session: HelperSession, set: WatchSet): Promise<number> {
  const { watching, skipped } = await session.setWatch(set.projectId, set.paths);
  if (skipped.length) console.warn(`[remotes] 这些目录没挂上 watch：${skipped.join(' ')}`);
  return watching;
}

async function runStream(key: string, target: RemoteTarget, signal: AbortSignal): Promise<void> {
  let backoff = RECONNECT_MIN_MS;
  let connected = false;
  while (!signal.aborted) {
    const session = helperSession(target);
    for (const set of setsOf(key)) await apply(session, set).catch(() => {});
    if (connected) for (const set of setsOf(key)) notifyRemoteChange(set.root);
    connected = true;
    try {
      await session.watchEvents((event) => handleEvent(key, event), signal);
      backoff = RECONNECT_MIN_MS;
    } catch (error) {
      if (!signal.aborted) console.warn('[remotes] watch 流中断，退避重连', error);
    }
    if (signal.aborted) break;
    await new Promise((resolve) => setTimeout(resolve, backoff));
    backoff = Math.min(backoff * 2, RECONNECT_MAX_MS);
  }
}

function stopStream(key: string): void {
  const stream = streams.get(key);
  if (!stream) return;
  streams.delete(key);
  stream.controller.abort();
}

export function syncRemoteWatch(target: RemoteTarget): void {
  const key = targetKey(target);
  if (streams.has(key) || !setsOf(key).length) return;
  const controller = new AbortController();
  streams.set(key, { target, controller });
  void runStream(key, target, controller.signal).catch((error: unknown) => {
    console.warn('[remotes] watch 循环退出', error);
  });
}

export async function watchRemoteProject(input: RemoteWatchInput): Promise<{ watching: number }> {
  if (!input.paths.length) {
    await unwatchRemoteProject(input.projectId);
    return { watching: 0 };
  }
  desired.set(input.projectId, { ...input, targetKey: targetKey(input.target) });
  syncRemoteWatch(input.target);
  const set = desired.get(input.projectId);
  return { watching: set ? await apply(helperSession(input.target), set).catch(() => 0) : 0 };
}

export async function unwatchRemoteProject(projectId: string): Promise<void> {
  const set = desired.get(projectId);
  if (!set) return;
  desired.delete(projectId);
  await helperSession(set.target)
    .clearWatch(projectId)
    .catch(() => {});
  if (!setsOf(set.targetKey).length) stopStream(set.targetKey);
}

export function closeRemoteWatch(): void {
  for (const key of [...streams.keys()]) stopStream(key);
  desired.clear();
}
