import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, watch } from 'node:fs';
import {
  access,
  appendFile,
  chmod,
  copyFile,
  lstat,
  mkdir,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, sep } from 'node:path';
import { promisify } from 'node:util';
import { gunzip, gzip } from 'node:zlib';
import type { FileChangeDetail, TurnChanges } from '../protocol/agent';
import { hostPorts } from '../ports';
import { saveTurnChanges, storedFileChange, type StoredFile } from './changes';

const compress = promisify(gzip);
const decompress = promisify(gunzip);
const STORED_BYTE_LIMIT = 5 * 1024 * 1024;
const FILE_LIMIT = 10_000;
const WATCH_DELAY_MS = 100;
const skipped = new Set(['.git', 'node_modules', '.venv', 'venv', '__pycache__']);
const privateRuntime = new Set(['.home', '.cache']);
const roots = { privacy: 'chat-sessions', share: 'chat-share' } as const;
type Root = keyof typeof roots;
const uuid = /^[0-9a-f-]{36}$/i;
const virtualRoot = /^\/(privacy|share)(?:\/|$)/;
const readOnlyTools = new Set([
  'read',
  'read_skill',
  'ls',
  'grep',
  'find',
  'web_search',
  'web_fetch',
  'session_search',
  'session_read',
  'task',
  'task_output',
  'task_stop',
  'ask_user',
]);
const pathTools = new Set(['write', 'edit', 'delete', 'mkdir', 'download_file']);

export interface FileVersion {
  hash: string;
  bytes: number;
  mode: number;
  mtimeMs: number;
  stored: boolean;
}

export interface AgentActor {
  kind: 'agent';
  sessionId: string;
  turnId: string;
  parentTurnId?: string;
}

export type ChangeSource =
  | { kind: 'user' }
  | AgentActor
  | { kind: 'branch'; sessionId: string; entryId: string }
  | { kind: 'revert'; turnIds: string[] }
  | { kind: 'turn-start'; turnId: string };

interface FileChange {
  path: string;
  before: FileVersion | null;
  after: FileVersion | null;
}

interface ChangeEvent {
  id: string;
  at: string;
  source: ChangeSource;
  changes: FileChange[];
}

type FileTree = Map<string, FileVersion>;

interface Owner {
  loaded: boolean;
  events: ChangeEvent[];
  tree: FileTree;
  windows: AgentActor[];
  locks: Map<string, number>;
  exclusive: Promise<void>;
  queue: Promise<unknown>;
  timer?: ReturnType<typeof setTimeout>;
}

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));
const user: ChangeSource = { kind: 'user' };

function storeDirectory(sessionId: string) {
  if (!uuid.test(sessionId)) throw new Error('无效会话标识');
  return join(hostPorts().paths.userData(), 'chat-files', sessionId);
}
const blobPath = (sessionId: string, hash: string) =>
  join(storeDirectory(sessionId), 'blobs', `${hash}.gz`);
const logPath = (sessionId: string) => join(storeDirectory(sessionId), 'events.jsonl');
const rootDirectory = (sessionId: string, root: Root) =>
  join(hostPorts().paths.storage(), roots[root], sessionId);

function hostPath(sessionId: string, path: string) {
  const [root, ...parts] = path.split('/');
  return join(rootDirectory(sessionId, root as Root), ...parts);
}

const owners = new Map<string, Owner>();
function ownerOf(sessionId: string): Owner {
  let owner = owners.get(sessionId);
  if (!owner) {
    owner = {
      loaded: false,
      events: [],
      tree: new Map(),
      windows: [],
      locks: new Map(),
      exclusive: Promise.resolve(),
      queue: Promise.resolve(),
    };
    owners.set(sessionId, owner);
  }
  return owner;
}

function serialized<T>(sessionId: string, work: (owner: Owner) => Promise<T>): Promise<T> {
  const owner = ownerOf(sessionId);
  const run = async () => {
    if (!owner.loaded) await load(sessionId, owner);
    return work(owner);
  };
  const next = owner.queue.then(run, run);
  owner.queue = next.catch(() => {});
  return next;
}

async function load(sessionId: string, owner: Owner) {
  let text = '';
  try {
    text = await readFile(logPath(sessionId), 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  owner.events = text
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as ChangeEvent);
  owner.tree = treeAt(owner.events);
  owner.loaded = true;
  await sync(sessionId, owner, () => user);
}

function treeAt(events: ChangeEvent[]): FileTree {
  const tree: FileTree = new Map();
  const start = Math.max(
    0,
    events.findLastIndex((event) => event.source.kind === 'branch'),
  );
  for (const event of events.slice(start))
    for (const change of event.changes)
      if (change.after) tree.set(change.path, change.after);
      else tree.delete(change.path);
  return tree;
}

async function storeBlob(sessionId: string, hash: string, content: Buffer) {
  const path = blobPath(sessionId, hash);
  try {
    await access(path);
    return;
  } catch {}
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${randomUUID()}.tmp`;
  await writeFile(temporary, await compress(content));
  await rename(temporary, path);
}

async function readBlob(sessionId: string, hash: string): Promise<Buffer> {
  return decompress(await readFile(blobPath(sessionId, hash)));
}

async function versionOf(
  sessionId: string,
  file: string,
  known: FileVersion | undefined,
): Promise<FileVersion> {
  const info = await lstat(file);
  const mode = info.mode & 0o777;
  if (known && known.bytes === info.size && known.mtimeMs === info.mtimeMs)
    return { ...known, mode };
  if (info.size > STORED_BYTE_LIMIT)
    return {
      hash: `size:${info.size}:${info.mtimeMs}`,
      bytes: info.size,
      mode,
      mtimeMs: info.mtimeMs,
      stored: false,
    };
  const content = await readFile(file);
  const hash = createHash('sha256').update(content).digest('hex');
  await storeBlob(sessionId, hash, content);
  return { hash, bytes: content.length, mode, mtimeMs: info.mtimeMs, stored: true };
}

const locked = (owner: Owner, path: string) =>
  [...owner.locks.keys()].some((key) => path === key || path.startsWith(`${key}/`));

async function scan(sessionId: string, owner: Owner): Promise<FileTree> {
  const tree: FileTree = new Map();
  for (const [path, version] of owner.tree) if (locked(owner, path)) tree.set(path, version);
  for (const root of Object.keys(roots) as Root[]) {
    const base = rootDirectory(sessionId, root);
    const directories = [''];
    while (directories.length) {
      const directory = directories.pop()!;
      let entries;
      try {
        entries = await readdir(join(base, directory), { withFileTypes: true });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
        throw error;
      }
      for (const entry of entries) {
        if (skipped.has(entry.name)) continue;
        if (root === 'privacy' && !directory && privateRuntime.has(entry.name)) continue;
        const name = directory ? `${directory}/${entry.name}` : entry.name;
        const path = `${root}/${name}`;
        if (locked(owner, path)) continue;
        if (entry.isDirectory()) directories.push(name);
        else if (entry.isFile()) {
          if (tree.size >= FILE_LIMIT) throw new Error('聊天文件超过 10,000 个，未记录版本');
          tree.set(path, await versionOf(sessionId, join(base, name), owner.tree.get(path)));
        }
      }
    }
  }
  return tree;
}

function changesBetween(before: FileTree, after: FileTree): FileChange[] {
  return [...new Set([...before.keys(), ...after.keys()])].sort().flatMap((path) => {
    const old = before.get(path) ?? null;
    const current = after.get(path) ?? null;
    return old?.hash === current?.hash && old?.mode === current?.mode
      ? []
      : [{ path, before: old, after: current }];
  });
}

async function append(
  sessionId: string,
  owner: Owner,
  source: ChangeSource,
  changes: FileChange[],
) {
  const event: ChangeEvent = { id: randomUUID(), at: new Date().toISOString(), source, changes };
  await mkdir(storeDirectory(sessionId), { recursive: true });
  await appendFile(logPath(sessionId), `${JSON.stringify(event)}\n`);
  owner.events.push(event);
  for (const change of changes)
    if (change.after) owner.tree.set(change.path, change.after);
    else owner.tree.delete(change.path);
}

async function sync(
  sessionId: string,
  owner: Owner,
  attribute: (change: FileChange) => ChangeSource | null,
) {
  const groups = new Map<string, { source: ChangeSource; changes: FileChange[] }>();
  for (const change of changesBetween(owner.tree, await scan(sessionId, owner))) {
    const source = attribute(change);
    if (!source) continue;
    const key = JSON.stringify(source);
    const group = groups.get(key) ?? { source, changes: [] };
    group.changes.push(change);
    groups.set(key, group);
  }
  for (const { source, changes } of groups.values())
    await append(sessionId, owner, source, changes);
}

const current = (owner: Owner) => owner.windows.at(-1) ?? user;
const syncCurrent = (sessionId: string, owner: Owner) =>
  sync(sessionId, owner, () => current(owner));

export function startChatTurn(sessionId: string, turnId: string): Promise<void> {
  return serialized(sessionId, async (owner) => {
    await syncCurrent(sessionId, owner);
    await append(sessionId, owner, { kind: 'turn-start', turnId }, []);
  });
}

export async function openChatWindow(
  sessionId: string,
  actor: AgentActor,
  exclusive: boolean,
): Promise<() => Promise<void>> {
  const owner = ownerOf(sessionId);
  let release = () => {};
  if (exclusive) {
    const previous = owner.exclusive;
    owner.exclusive = new Promise((resolve) => {
      release = resolve;
    });
    await previous;
  }
  try {
    await serialized(sessionId, async () => {
      await syncCurrent(sessionId, owner);
      owner.windows.push(actor);
    });
  } catch (error) {
    release();
    throw error;
  }
  let closing: Promise<void> | undefined;
  return () =>
    (closing ??= serialized(sessionId, async () => {
      try {
        await sync(sessionId, owner, () => actor);
      } finally {
        owner.windows.splice(owner.windows.indexOf(actor), 1);
      }
    }).finally(release));
}

function lockPath(sessionId: string, path: string, source: ChangeSource): () => Promise<void> {
  const owner = ownerOf(sessionId);
  owner.locks.set(path, (owner.locks.get(path) ?? 0) + 1);
  let releasing: Promise<void> | undefined;
  return () =>
    (releasing ??= serialized(sessionId, async () => {
      const count = owner.locks.get(path)! - 1;
      if (count) owner.locks.set(path, count);
      else owner.locks.delete(path);
      await sync(sessionId, owner, (change) =>
        change.path === path || change.path.startsWith(`${path}/`) ? source : null,
      );
    }));
}

function toolPath(sessionId: string, raw: string): string | null {
  const path = raw.replaceAll('\\', '/');
  const virtual = virtualRoot.exec(path);
  const absolute = virtual
    ? join(rootDirectory(sessionId, virtual[1] as Root), path.slice(virtual[0].length))
    : isAbsolute(raw)
      ? raw
      : join(rootDirectory(sessionId, 'privacy'), raw);
  const key = chatFileKey(absolute);
  return key?.sessionId === sessionId ? key.path : null;
}

const toolEnds = new Map<string, Map<string, () => Promise<void>>>();

export async function beginChatTool(
  ownerId: string,
  actor: AgentActor,
  call: { toolName: string; toolCallId: string; input: Record<string, unknown> },
): Promise<void> {
  if (readOnlyTools.has(call.toolName)) return;
  let end: () => Promise<void>;
  if (pathTools.has(call.toolName)) {
    const path = typeof call.input.path === 'string' ? toolPath(ownerId, call.input.path) : null;
    if (!path) return;
    end = lockPath(ownerId, path, actor);
  } else end = await openChatWindow(ownerId, actor, true);
  const ends = toolEnds.get(actor.sessionId) ?? new Map<string, () => Promise<void>>();
  ends.set(call.toolCallId, end);
  toolEnds.set(actor.sessionId, ends);
}

export async function endChatTool(sessionId: string, toolCallId: string): Promise<void> {
  const end = toolEnds.get(sessionId)?.get(toolCallId);
  toolEnds.get(sessionId)?.delete(toolCallId);
  await end?.();
}

export async function endChatTools(sessionId: string): Promise<void> {
  const ends = [...(toolEnds.get(sessionId)?.values() ?? [])];
  toolEnds.delete(sessionId);
  await Promise.all(ends.map((end) => end()));
}

export function userChatWrite<T>(paths: string[], work: () => T): T {
  const releases = paths.flatMap((path) => {
    const key = chatFileKey(path);
    return key ? [lockPath(key.sessionId, key.path, user)] : [];
  });
  const release = () => {
    for (const end of releases)
      void end().catch((error: unknown) => console.error('记录聊天文件版本失败', error));
  };
  let result: T;
  try {
    result = work();
  } catch (error) {
    release();
    throw error;
  }
  if (result instanceof Promise) return result.finally(release) as T;
  release();
  return result;
}

export function watchChatFiles(sessionExists: (id: string) => boolean): () => void {
  const storage = hostPorts().paths.storage();
  const watchers = (Object.entries(roots) as [Root, string][]).map(([root, directory]) => {
    const base = join(storage, directory);
    mkdirSync(base, { recursive: true });
    const watcher = watch(base, { recursive: true, persistent: false }, (_event, name) => {
      if (!name) return;
      const [sessionId, first] = name.split(/[\\/]/);
      if (!sessionId || !uuid.test(sessionId)) return;
      if (root === 'privacy' && first && privateRuntime.has(first)) return;
      const owner = ownerOf(sessionId);
      clearTimeout(owner.timer);
      owner.timer = setTimeout(() => {
        if (!sessionExists(sessionId)) return;
        void serialized(sessionId, (current) => syncCurrent(sessionId, current)).catch(
          (error: unknown) => console.error('记录聊天文件版本失败', error),
        );
      }, WATCH_DELAY_MS);
    });
    watcher.on('error', (error) => console.error('聊天文件监听失败', error));
    return watcher;
  });
  return () => {
    for (const watcher of watchers) watcher.close();
  };
}

async function storedFile(
  sessionId: string,
  version: FileVersion | null,
): Promise<StoredFile | null> {
  if (!version) return null;
  return {
    bytes: version.bytes,
    mode: version.mode,
    fingerprint: version.hash,
    content: version.stored ? await readBlob(sessionId, version.hash) : null,
  };
}

const ofTurns = (source: ChangeSource, turnIds: ReadonlySet<string>) =>
  source.kind === 'agent' &&
  (turnIds.has(source.turnId) ||
    (source.parentTurnId !== undefined && turnIds.has(source.parentTurnId)));

export async function freezeChatTurn(
  ownerId: string,
  sessionId: string,
  turnId: string,
  startedAt: string,
  runStatus: TurnChanges['runStatus'],
  unavailableReason?: string,
): Promise<void> {
  const warnings = unavailableReason ? [unavailableReason] : [];
  const files = [];
  if (!unavailableReason)
    try {
      const net = new Map<string, FileChange>();
      for (const event of await serialized(ownerId, async (owner) => owner.events))
        if (ofTurns(event.source, new Set([turnId])))
          for (const change of event.changes)
            if (change.path.startsWith('share/'))
              net.set(change.path, {
                path: change.path,
                before: net.get(change.path)?.before ?? change.before,
                after: change.after,
              });
      for (const change of net.values())
        if (change.before?.hash !== change.after?.hash)
          files.push({
            path: `/${change.path}`,
            before: await storedFile(ownerId, change.before),
            after: await storedFile(ownerId, change.after),
          });
    } catch (error) {
      warnings.push(errorText(error));
    }
  await saveTurnChanges(
    sessionId,
    {
      turnId,
      cwd: rootDirectory(ownerId, 'share'),
      startedAt,
      finishedAt: new Date().toISOString(),
      runStatus,
      state: warnings.length ? 'unavailable' : 'complete',
      warnings,
    },
    files,
  );
}

async function restore(sessionId: string, path: string, version: FileVersion | null) {
  const target = hostPath(sessionId, path);
  const existing = await lstat(target).catch(() => null);
  if (existing && !existing.isFile()) return;
  if (!version) {
    if (existing) await rm(target);
    return;
  }
  await mkdir(dirname(target), { recursive: true });
  const root = await realpath(rootDirectory(sessionId, path.split('/')[0] as Root));
  const parent = relative(root, await realpath(dirname(target)));
  if (parent === '..' || parent.startsWith(`..${sep}`) || isAbsolute(parent)) return;
  await writeFile(target, await readBlob(sessionId, version.hash));
  await chmod(target, version.mode);
}

export function revertChatTurns(sessionId: string, turnIds: string[]) {
  return serialized(sessionId, async (owner) => {
    await syncCurrent(sessionId, owner);
    const reverted = new Set(turnIds);
    const state = new Map(owner.tree);
    for (const event of owner.events.toReversed()) {
      if (!ofTurns(event.source, reverted)) continue;
      for (const change of event.changes) {
        if ((state.get(change.path)?.hash ?? null) !== (change.after?.hash ?? null)) continue;
        if (change.before && !change.before.stored) continue;
        await restore(sessionId, change.path, change.before);
        if (change.before) state.set(change.path, change.before);
        else state.delete(change.path);
      }
    }
    await sync(sessionId, owner, () => ({ kind: 'revert', turnIds }));
  });
}

export function branchChatFiles(
  sourceId: string,
  targetId: string,
  entryId: string,
  nextTurnId: string | undefined,
  inheritedTurnIds: string[],
) {
  return serialized(sourceId, async (source) => {
    await syncCurrent(sourceId, source);
    const next = source.events.findIndex(
      (event) => event.source.kind === 'turn-start' && event.source.turnId === nextTurnId,
    );
    const tree = next >= 0 ? treeAt(source.events.slice(0, next)) : new Map(source.tree);
    const inheritedTurns = new Set(inheritedTurnIds);
    const inherited = source.events.filter((event) => ofTurns(event.source, inheritedTurns));
    await serialized(targetId, async (target) => {
      for (const version of inherited.flatMap((event) =>
        event.changes.flatMap(({ before, after }) => [before, after]),
      ))
        if (version?.stored) {
          const blob = blobPath(targetId, version.hash);
          await mkdir(dirname(blob), { recursive: true });
          await copyFile(blobPath(sourceId, version.hash), blob);
        }
      for (const event of inherited) {
        await mkdir(storeDirectory(targetId), { recursive: true });
        await appendFile(logPath(targetId), `${JSON.stringify(event)}\n`);
        target.events.push(event);
      }
      const changes: FileChange[] = [];
      for (const [path, version] of tree) {
        const file = hostPath(targetId, path);
        await mkdir(dirname(file), { recursive: true });
        if (version.stored) await writeFile(file, await readBlob(sourceId, version.hash));
        else {
          const origin = hostPath(sourceId, path);
          const info = await lstat(origin).catch(() => null);
          if (!info?.isFile() || `size:${info.size}:${info.mtimeMs}` !== version.hash) continue;
          await copyFile(origin, file);
        }
        await chmod(file, version.mode);
        changes.push({ path, before: null, after: await versionOf(targetId, file, undefined) });
      }
      target.tree = new Map();
      await append(targetId, target, { kind: 'branch', sessionId: sourceId, entryId }, changes);
    });
  });
}

export async function deleteChatFiles(sessionId: string): Promise<void> {
  const owner = ownerOf(sessionId);
  owner.loaded = true;
  await serialized(sessionId, () =>
    rm(storeDirectory(sessionId), { recursive: true, force: true }),
  );
  clearTimeout(owner.timer);
  owners.delete(sessionId);
}

export function chatFileKey(file: string): { sessionId: string; path: string } | null {
  const storage = hostPorts().paths.storage();
  for (const [root, directory] of Object.entries(roots)) {
    const part = relative(join(storage, directory), file);
    if (!part || part === '..' || part.startsWith(`..${sep}`) || isAbsolute(part)) continue;
    const [sessionId, ...rest] = part.split(sep);
    return sessionId && uuid.test(sessionId) && rest.length
      ? { sessionId, path: [root, ...rest].join('/') }
      : null;
  }
  return null;
}

const runKey = (event: ChangeEvent) => {
  const { source } = event;
  if (source.kind === 'user') return 'user';
  if (source.kind === 'agent') return `agent:${source.sessionId}:${source.turnId}`;
  return event.id;
};

export function chatFileHistory(sessionId: string, path: string) {
  return serialized(sessionId, async (owner) => {
    await syncCurrent(sessionId, owner);
    const runs: { from: ChangeEvent; to: ChangeEvent; first: FileChange; last: FileChange }[] = [];
    for (const event of owner.events) {
      const change = event.changes.find((change) => change.path === path);
      if (!change) continue;
      const previous = runs.at(-1);
      if (previous && runKey(previous.to) === runKey(event)) {
        previous.to = event;
        previous.last = change;
      } else runs.push({ from: event, to: event, first: change, last: change });
    }
    return runs;
  });
}

export async function readChatFileVersion(
  sessionId: string,
  fromEventId: string,
  toEventId: string,
  path: string,
): Promise<FileChangeDetail> {
  const events = await serialized(sessionId, async (owner) => owner.events);
  const changeIn = (id: string) =>
    events.find((event) => event.id === id)?.changes.find((change) => change.path === path);
  const from = changeIn(fromEventId);
  const to = changeIn(toEventId);
  if (!from || !to) throw new Error('这个版本没有此文件的记录');
  return storedFileChange({
    path,
    before: await storedFile(sessionId, from.before),
    after: await storedFile(sessionId, to.after),
  });
}
