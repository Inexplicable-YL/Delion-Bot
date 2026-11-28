import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, watch } from 'node:fs';
import {
  access,
  chmod,
  copyFile,
  lstat,
  mkdir,
  readFile,
  readdir,
  realpath,
  rm,
  writeFile,
} from 'node:fs/promises';
import type { Stats } from 'node:fs';
import { dirname, isAbsolute, join, relative, sep } from 'node:path';
import type { FileChangeDetail, TurnChanges } from '../protocol/agent';
import { hostPorts } from '../ports';
import { saveTurnChanges, storedFileChange, type StoredChange, type StoredFile } from './changes';

const STORED_BYTE_LIMIT = 5 * 1024 * 1024;
const FILE_LIMIT = 10_000;
const WATCH_DELAY_MS = 100;
const MERGE_IDLE_MS = 15_000;
const MERGE_MAX_MS = 30_000;
const BRANCH = 'refs/heads/main';
const NO_OBJECT = '0'.repeat(40);
const LARGE = '.large/';
const GIT_TIMEOUT_MS = 120_000;
const hasControlCharacter = (text: string) =>
  [...text].some((character) => character < ' ' || character === '\x7f');
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
  oid: string;
  mode: number;
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
  | { kind: 'revert'; turnIds: string[] };

interface FileChange {
  path: string;
  before: FileVersion | null;
  after: FileVersion | null;
}

interface ChangeEvent {
  id: string;
  at: string;
  source: ChangeSource;
  startsTurns: string[];
  changes: FileChange[];
}

type PendingEvent = Omit<ChangeEvent, 'id'>;
type OpenEvent = PendingEvent & { startedAt: number; deadline: number; timer: NodeJS.Timeout };
type FileTree = Map<string, FileVersion>;

interface Owner {
  loaded: boolean;
  head: string | null;
  events: ChangeEvent[];
  pending: PendingEvent[];
  openEvent?: OpenEvent;
  inflight: PendingEvent[];
  flushing?: Promise<void>;
  tree: FileTree;
  blobs: Map<string, Buffer>;
  seen: Map<string, { bytes: number; mtimeMs: number; version: FileVersion }>;
  turnStarts: string[];
  dirty: boolean;
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
const gitDirectory = (sessionId: string) => join(storeDirectory(sessionId), '.git');
const rootDirectory = (sessionId: string, root: Root) =>
  join(hostPorts().paths.storage(), roots[root], sessionId);

function hostPath(sessionId: string, path: string) {
  const [root, ...parts] = path.split('/');
  return join(rootDirectory(sessionId, root as Root), ...parts);
}

function git(sessionId: string, args: string[], input: string | Buffer = ''): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      'git',
      [`--git-dir=${gitDirectory(sessionId)}`, '-c', 'core.protectNTFS=false', ...args],
      {
        windowsHide: true,
        timeout: GIT_TIMEOUT_MS,
        env: {
          ...Object.fromEntries(
            Object.entries(process.env).filter(([key]) => !key.toUpperCase().startsWith('GIT_')),
          ),
          LC_ALL: 'C',
        },
      },
    );
    const output: Buffer[] = [];
    const errors: Buffer[] = [];
    child.stdout.on('data', (chunk: Buffer) => output.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => errors.push(chunk));
    child.on('error', reject);
    child.stdin.on('error', reject);
    child.on('close', (code, signal) =>
      code === 0
        ? resolve(Buffer.concat(output))
        : reject(
            new Error(
              signal
                ? '版本库操作超时'
                : Buffer.concat(errors).toString('utf8').trim() || `git 退出码 ${code}`,
            ),
          ),
    );
    child.stdin.end(input);
  });
}

const blobId = (content: Buffer) =>
  createHash('sha1').update(`blob ${content.length}\0`).update(content).digest('hex');
const treePath = (path: string, version: FileVersion) => (version.stored ? path : LARGE + path);
const gitMode = (version: FileVersion) => (version.mode & 0o111 ? '100755' : '100644');
const quoted = (path: string) => `"${path.replace(/["\\]/g, '\\$&')}"`;
const versionAt = (path: string, oid: string, mode: string) => {
  const stored = !path.startsWith(LARGE);
  return {
    path: stored ? path : path.slice(LARGE.length),
    version: { oid, mode: parseInt(mode, 8) & 0o777, stored },
  };
};

function parseLog(output: Buffer): ChangeEvent[] {
  return output
    .toString('utf8')
    .split('\x1e')
    .slice(1)
    .map((record) => {
      const [id, at, body, ...diff] = record.split('\0');
      const changes = new Map<string, FileChange>();
      for (let index = 0; index + 1 < diff.length; index += 2) {
        const [oldMode, newMode, oldOid, newOid] = diff[index]!.trim().slice(1).split(' ');
        const before = versionAt(diff[index + 1]!, oldOid!, oldMode!);
        const after = versionAt(diff[index + 1]!, newOid!, newMode!);
        const change = changes.get(before.path) ?? { path: before.path, before: null, after: null };
        if (oldOid !== NO_OBJECT) change.before = before.version;
        if (newOid !== NO_OBJECT) change.after = after.version;
        changes.set(before.path, change);
      }
      const message = JSON.parse(body!) as { source: ChangeSource; startsTurns?: string[] };
      return {
        id: id!,
        at: at!,
        source: message.source,
        startsTurns: message.startsTurns ?? [],
        changes: [...changes.values()],
      };
    });
}

async function readBlobs(
  sessionId: string,
  owner: Owner,
  oids: string[],
): Promise<Map<string, Buffer>> {
  const blobs = new Map<string, Buffer>();
  const missing = [...new Set(oids)].filter((oid) => {
    const content = owner.blobs.get(oid);
    if (content) blobs.set(oid, content);
    return !content;
  });
  if (!missing.length) return blobs;
  const output = await git(
    sessionId,
    ['cat-file', '--batch'],
    missing.map((oid) => `${oid}\n`).join(''),
  );
  let offset = 0;
  for (const oid of missing) {
    const end = output.indexOf(10, offset);
    const [, type, size] = output.subarray(offset, end).toString('utf8').split(' ');
    if (type !== 'blob') throw new Error('版本库缺少文件内容');
    const start = end + 1;
    blobs.set(oid, output.subarray(start, start + Number(size)));
    offset = start + Number(size) + 1;
  }
  return blobs;
}

const owners = new Map<string, Owner>();
let watching = false;
let onShareCommit: (() => void) | undefined;
function ownerOf(sessionId: string): Owner {
  let owner = owners.get(sessionId);
  if (!owner) {
    owner = {
      loaded: false,
      head: null,
      events: [],
      pending: [],
      inflight: [],
      tree: new Map(),
      blobs: new Map(),
      seen: new Map(),
      turnStarts: [],
      dirty: false,
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

async function readRepository(sessionId: string, owner: Owner) {
  owner.events = parseLog(
    await git(sessionId, [
      'log',
      '--reverse',
      '--root',
      '--raw',
      '--no-renames',
      '--no-abbrev',
      '--no-color',
      '-z',
      '--format=%x1e%H%x00%cI%x00%B',
      '--branches',
    ]),
  );
  owner.head = owner.events.at(-1)?.id ?? null;
  replayTree(owner);
}

function replayTree(owner: Owner) {
  owner.tree.clear();
  for (const event of owner.events)
    for (const change of event.changes)
      if (change.after) owner.tree.set(change.path, change.after);
      else owner.tree.delete(change.path);
}

async function load(sessionId: string, owner: Owner) {
  try {
    await access(join(gitDirectory(sessionId), 'HEAD'));
  } catch {
    await mkdir(gitDirectory(sessionId), { recursive: true });
    await git(sessionId, ['init', '--bare', '--quiet', '--object-format=sha1']);
  }
  await readRepository(sessionId, owner);
  owner.loaded = true;
  await sync(sessionId, owner, user);
}

function liveBlobs(owner: Owner) {
  const live = new Set(
    [...owner.inflight, ...owner.pending, owner.openEvent].flatMap(
      (event) => event?.changes.flatMap(({ after }) => (after ? [after.oid] : [])) ?? [],
    ),
  );
  for (const oid of owner.blobs.keys()) if (!live.has(oid)) owner.blobs.delete(oid);
}

async function writeBatch(sessionId: string, owner: Owner) {
  const chunks: Buffer[] = [];
  const text = (value: string) => chunks.push(Buffer.from(value));
  const data = (content: Buffer) => {
    text(`data ${content.length}\n`);
    chunks.push(content);
    text('\n');
  };
  owner.inflight.forEach((event, index) => {
    text(
      `commit ${BRANCH}\nmark :${index + 1}\ncommitter Delion Bot <delion@localhost> ${Math.floor(Date.parse(event.at) / 1000)} +0000\n`,
    );
    data(
      Buffer.from(
        JSON.stringify({
          source: event.source,
          ...(event.startsTurns.length && { startsTurns: event.startsTurns }),
        }),
      ),
    );
    if (index === 0 && owner.head) text(`from ${owner.head}\n`);
    for (const { path, before, after } of event.changes) {
      if (before && (!after || treePath(path, before) !== treePath(path, after)))
        text(`D ${quoted(treePath(path, before))}\n`);
      if (!after) continue;
      const content = owner.blobs.get(after.oid);
      const target = quoted(treePath(path, after));
      if (content) {
        text(`M ${gitMode(after)} inline ${target}\n`);
        data(content);
      } else text(`M ${gitMode(after)} ${after.oid} ${target}\n`);
    }
    text(`get-mark :${index + 1}\n`);
  });
  text('done\n');
  const ids = (await git(sessionId, ['fast-import', '--quiet', '--done'], Buffer.concat(chunks)))
    .toString('utf8')
    .trim()
    .split('\n');
  owner.events.push(...owner.inflight.map((event, index) => ({ ...event, id: ids[index]! })));
  owner.head = ids.at(-1)!;
  if (owner.inflight.some((event) => event.changes.some(({ path }) => path.startsWith('share/'))))
    onShareCommit?.();
}

function flush(sessionId: string, owner: Owner): Promise<void> {
  if (!owner.pending.length) return owner.flushing ?? Promise.resolve();
  owner.flushing ??= (async () => {
    try {
      while (owner.pending.length) {
        owner.inflight = owner.pending.splice(0);
        try {
          await writeBatch(sessionId, owner);
        } catch (error) {
          closeMergeWindow(owner);
          owner.turnStarts.unshift(
            ...[...owner.inflight, ...owner.pending].flatMap(({ startsTurns }) => startsTurns),
          );
          owner.pending = [];
          owner.seen.clear();
          replayTree(owner);
          throw error;
        } finally {
          owner.inflight = [];
          liveBlobs(owner);
        }
      }
    } finally {
      owner.flushing = undefined;
    }
  })();
  return owner.flushing;
}

async function flushed(sessionId: string, owner: Owner) {
  await owner.flushing?.catch(() => {});
  closeMergeWindow(owner);
  await flush(sessionId, owner);
}

const locked = (owner: Owner, path: string) =>
  [...owner.locks.keys()].some((key) => path === key || path.startsWith(`${key}/`));

const tracked = (path: string) => {
  const parts = path.split('/');
  return (
    !parts.some((part) => skipped.has(part) || hasControlCharacter(part)) &&
    !(parts[0] === 'privacy' && privateRuntime.has(parts[1] ?? ''))
  );
};

const within = (path: string, scope: string | undefined) =>
  !scope || path === scope || path.startsWith(`${scope}/`);

async function scan(sessionId: string, owner: Owner, scope?: string): Promise<FileTree> {
  const tree: FileTree = new Map();
  for (const [path, version] of owner.tree)
    if (within(path, scope) && locked(owner, path)) tree.set(path, version);
  const visit = async (path: string, file: string, info: Stats) => {
    if (tree.size >= FILE_LIMIT) throw new Error('聊天文件超过 10,000 个，未记录版本');
    const mode = info.mode & 0o111 ? 0o755 : 0o644;
    const seen = owner.seen.get(path);
    if (seen && seen.bytes === info.size && seen.mtimeMs === info.mtimeMs) {
      tree.set(path, { ...seen.version, mode });
      return;
    }
    const stored = info.size <= STORED_BYTE_LIMIT;
    const content = stored
      ? await readFile(file)
      : Buffer.from(JSON.stringify({ bytes: info.size, mtimeMs: info.mtimeMs }));
    const version = { oid: blobId(content), mode, stored };
    owner.seen.set(path, { bytes: info.size, mtimeMs: info.mtimeMs, version });
    if (owner.tree.get(path)?.oid !== version.oid) owner.blobs.set(version.oid, content);
    tree.set(path, version);
  };
  const paths = scope ? [scope] : (Object.keys(roots) as string[]);
  while (paths.length) {
    const path = paths.pop()!;
    if (!tracked(path) || locked(owner, path)) continue;
    const file = hostPath(sessionId, path);
    const info = await lstat(file).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return null;
      throw error;
    });
    if (info?.isDirectory())
      for (const name of await readdir(file).catch((error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') return [];
        throw error;
      }))
        paths.push(`${path}/${name}`);
    else if (info?.isFile() && path.includes('/')) await visit(path, file, info);
  }
  return tree;
}

function changesBetween(before: FileTree, after: FileTree): FileChange[] {
  return [...new Set([...before.keys(), ...after.keys()])].sort().flatMap((path) => {
    const old = before.get(path) ?? null;
    const current = after.get(path) ?? null;
    return old?.oid === current?.oid && old?.mode === current?.mode
      ? []
      : [{ path, before: old, after: current }];
  });
}

const sameVersion = (left: FileVersion | null, right: FileVersion | null) =>
  left?.oid === right?.oid && left?.mode === right?.mode;

function closeMergeWindow(owner: Owner) {
  const event = owner.openEvent;
  if (!event) return;
  clearTimeout(event.timer);
  owner.openEvent = undefined;
  if (event.changes.length || event.startsTurns.length) owner.pending.push(event);
}

function flushInBackground(sessionId: string, owner: Owner) {
  void flush(sessionId, owner).catch((error: unknown) =>
    console.error('保存聊天文件版本失败', error),
  );
}

function append(sessionId: string, owner: Owner, source: ChangeSource, changes: FileChange[]) {
  if (!changes.length) return;
  for (const change of changes)
    if (change.after) owner.tree.set(change.path, change.after);
    else owner.tree.delete(change.path);
  const startsTurns = owner.turnStarts.splice(0);
  const now = Date.now();
  const at = new Date(now).toISOString();
  const last = owner.openEvent;
  const merge =
    last &&
    now < last.deadline &&
    !startsTurns.length &&
    JSON.stringify(last.source) === JSON.stringify(source);
  if (merge) {
    for (const change of changes) {
      const index = last.changes.findIndex(({ path }) => path === change.path);
      if (index < 0) last.changes.push(change);
      else if (sameVersion(last.changes[index]!.before, change.after))
        last.changes.splice(index, 1);
      else last.changes[index] = { ...last.changes[index]!, after: change.after };
    }
    clearTimeout(last.timer);
  } else closeMergeWindow(owner);

  if (source.kind === 'user' || source.kind === 'agent') {
    const startedAt = merge ? last.startedAt : now;
    const deadline = Math.min(now + MERGE_IDLE_MS, startedAt + MERGE_MAX_MS);
    const timer = setTimeout(() => {
      closeMergeWindow(owner);
      flushInBackground(sessionId, owner);
    }, deadline - now);
    timer.unref();
    owner.openEvent = {
      at,
      source,
      startsTurns: merge ? last.startsTurns : startsTurns,
      changes: merge ? last.changes : changes,
      startedAt,
      deadline,
      timer,
    };
  } else owner.pending.push({ at, source, startsTurns, changes });
  liveBlobs(owner);
  if (owner.pending.length) flushInBackground(sessionId, owner);
}

async function sync(sessionId: string, owner: Owner, source: ChangeSource, scope?: string) {
  if (!scope) owner.dirty = false;
  const before = scope
    ? new Map([...owner.tree].filter(([path]) => within(path, scope)))
    : owner.tree;
  append(sessionId, owner, source, changesBetween(before, await scan(sessionId, owner, scope)));
}

const current = (owner: Owner) => owner.windows.at(-1) ?? user;
const syncCurrent = (sessionId: string, owner: Owner) => sync(sessionId, owner, current(owner));

export function startChatTurn(sessionId: string, turnId: string): Promise<void> {
  return serialized(sessionId, async (owner) => {
    await syncCurrent(sessionId, owner);
    owner.turnStarts.push(turnId);
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
      if (!watching || owner.dirty) await syncCurrent(sessionId, owner);
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
        await sync(sessionId, owner, actor);
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
      await sync(sessionId, owner, source, path);
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

export function watchChatFiles(
  sessionExists: (id: string) => boolean,
  onCommit: () => void,
): () => void {
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
      owner.dirty = true;
      clearTimeout(owner.timer);
      owner.timer = setTimeout(() => {
        if (!sessionExists(sessionId)) return;
        void serialized(sessionId, (current) => syncCurrent(sessionId, current)).catch(
          (error: unknown) => console.error('记录聊天文件版本失败', error),
        );
      }, WATCH_DELAY_MS);
    });
    watcher.on('error', (error) => {
      watching = false;
      console.error('聊天文件监听失败', error);
    });
    return watcher;
  });
  onShareCommit = onCommit;
  watching = true;
  return () => {
    for (const watcher of watchers) watcher.close();
    onShareCommit = undefined;
    watching = false;
  };
}

export function hasPendingChatFiles(): boolean {
  return [...owners.values()].some(
    (owner) => owner.openEvent || owner.pending.length || owner.flushing,
  );
}

export async function flushChatFiles(): Promise<void> {
  await Promise.all(
    [...owners].map(([sessionId, owner]) =>
      flushed(sessionId, owner).catch((error: unknown) =>
        console.error('保存聊天文件版本失败', error),
      ),
    ),
  );
}

function storedFile(version: FileVersion | null, blobs: Map<string, Buffer>): StoredFile | null {
  if (!version) return null;
  const content = blobs.get(version.oid)!;
  return {
    bytes: version.stored
      ? content.length
      : (JSON.parse(content.toString('utf8')) as { bytes: number }).bytes,
    mode: version.mode,
    fingerprint: version.oid,
    content: version.stored ? content : null,
  };
}

const versionOids = (changes: FileChange[]) =>
  changes
    .flatMap(({ before, after }) => [before?.oid, after?.oid])
    .filter((oid) => oid !== undefined);

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
  const files: StoredChange[] = [];
  if (!unavailableReason)
    try {
      await serialized(ownerId, async (owner) => {
        await owner.flushing;
        const net = new Map<string, FileChange>();
        const turnIds = new Set([turnId]);
        const events = owner.openEvent ? [...owner.events, owner.openEvent] : owner.events;
        for (const event of events)
          if (ofTurns(event.source, turnIds))
            for (const change of event.changes)
              if (change.path.startsWith('share/')) {
                const previous = net.get(change.path);
                net.set(change.path, {
                  ...change,
                  before: previous ? previous.before : change.before,
                });
              }
        const changed = [...net.values()].filter(({ before, after }) => before?.oid !== after?.oid);
        const blobs = await readBlobs(ownerId, owner, versionOids(changed));
        for (const change of changed)
          files.push({
            path: `/${change.path}`,
            before: storedFile(change.before, blobs),
            after: storedFile(change.after, blobs),
          });
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

async function restore(sessionId: string, path: string, content: Buffer | null, mode: number) {
  const target = hostPath(sessionId, path);
  const existing = await lstat(target).catch(() => null);
  if (existing && !existing.isFile()) return;
  if (!content) {
    if (existing) await rm(target);
    return;
  }
  await mkdir(dirname(target), { recursive: true });
  const root = await realpath(rootDirectory(sessionId, path.split('/')[0] as Root));
  const parent = relative(root, await realpath(dirname(target)));
  if (parent === '..' || parent.startsWith(`..${sep}`) || isAbsolute(parent)) return;
  await writeFile(target, content);
  await chmod(target, mode);
}

export function revertChatTurns(sessionId: string, turnIds: string[]) {
  return serialized(sessionId, async (owner) => {
    await syncCurrent(sessionId, owner);
    await flushed(sessionId, owner);
    const reverted = new Set(turnIds);
    const state = new Map(owner.tree);
    const restored = new Map<string, FileVersion | null>();
    for (const event of owner.events.toReversed()) {
      if (!ofTurns(event.source, reverted)) continue;
      for (const change of event.changes) {
        if ((state.get(change.path)?.oid ?? null) !== (change.after?.oid ?? null)) continue;
        if (change.before && !change.before.stored) continue;
        restored.set(change.path, change.before);
        if (change.before) state.set(change.path, change.before);
        else state.delete(change.path);
      }
    }
    const blobs = await readBlobs(
      sessionId,
      owner,
      [...restored.values()].flatMap((version) => (version ? [version.oid] : [])),
    );
    for (const [path, version] of restored)
      await restore(
        sessionId,
        path,
        version ? blobs.get(version.oid)! : null,
        version?.mode ?? 0o644,
      );
    await sync(sessionId, owner, { kind: 'revert', turnIds });
  });
}

export function branchChatFiles(
  sourceId: string,
  targetId: string,
  entryId: string,
  laterTurnIds: string[],
) {
  return serialized(sourceId, async (source) => {
    await syncCurrent(sourceId, source);
    await flushed(sourceId, source);
    const later = new Set(laterTurnIds);
    const next = source.events.findIndex((event) =>
      event.startsTurns.some((turnId) => later.has(turnId)),
    );
    const point = next < 0 ? source.head : (source.events[next - 1]?.id ?? null);
    await serialized(targetId, async (target) => {
      if (point) {
        await git(sourceId, ['push', '--quiet', gitDirectory(targetId), `+${point}:${BRANCH}`]);
        await readRepository(targetId, target);
      }
      const blobs = await readBlobs(
        targetId,
        target,
        [...target.tree.values()].flatMap((version) => (version.stored ? [version.oid] : [])),
      );
      for (const [path, version] of target.tree) {
        const file = hostPath(targetId, path);
        await mkdir(dirname(file), { recursive: true });
        if (version.stored) await writeFile(file, blobs.get(version.oid)!);
        else if (source.tree.get(path)?.oid === version.oid)
          await copyFile(hostPath(sourceId, path), file);
        else continue;
        await chmod(file, version.mode);
      }
      await sync(targetId, target, { kind: 'branch', sessionId: sourceId, entryId });
    });
  });
}

export async function deleteChatFiles(sessionId: string): Promise<void> {
  const owner = ownerOf(sessionId);
  owner.loaded = true;
  await serialized(sessionId, async () => {
    closeMergeWindow(owner);
    owner.pending = [];
    await owner.flushing?.catch(() => {});
    await rm(storeDirectory(sessionId), { recursive: true, force: true });
  });
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

export function chatFileHistory(sessionId: string, path: string) {
  return serialized(sessionId, async (owner) => {
    await owner.flushing?.catch(() => {});
    return owner.events.flatMap((event) => {
      const change = event.changes.find((change) => change.path === path);
      return change ? [{ event, change }] : [];
    });
  });
}

export async function readChatFileVersion(
  sessionId: string,
  fromEventId: string,
  toEventId: string,
  path: string,
): Promise<FileChangeDetail> {
  const owner = ownerOf(sessionId);
  const events = await serialized(sessionId, async () => {
    await owner.flushing?.catch(() => {});
    return owner.events;
  });
  const changeIn = (id: string) =>
    events.find((event) => event.id === id)?.changes.find((change) => change.path === path);
  const from = changeIn(fromEventId);
  const to = changeIn(toEventId);
  if (!from || !to) throw new Error('这个版本没有此文件的记录');
  const blobs = await readBlobs(sessionId, owner, versionOids([from, to]));
  return storedFileChange({
    path,
    before: storedFile(from.before, blobs),
    after: storedFile(to.after, blobs),
  });
}
