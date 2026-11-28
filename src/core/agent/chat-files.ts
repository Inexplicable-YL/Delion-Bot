import { createHash, randomUUID } from 'node:crypto';
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
import { chatSessionDirectory, chatShareDirectory } from './session/store';

const compress = promisify(gzip);
const decompress = promisify(gunzip);
const STORED_BYTE_LIMIT = 5 * 1024 * 1024;
const FILE_LIMIT = 10_000;
const skipped = new Set(['.git', 'node_modules', '.venv', 'venv', '__pycache__']);
const privateRuntime = new Set(['.home', '.cache']);
const roots = { privacy: 'chat-sessions', share: 'chat-share' } as const;
type Root = keyof typeof roots;
const uuid = /^[0-9a-f-]{36}$/i;

export interface FileVersion {
  hash: string;
  bytes: number;
  mode: number;
  mtimeMs: number;
  stored: boolean;
}

export type ChangeSource =
  | { kind: 'user' }
  | { kind: 'turn'; sessionId: string; turnId: string }
  | { kind: 'branch'; sessionId: string; entryId: string }
  | { kind: 'revert'; turnIds: string[] };

interface FileChange {
  path: string;
  before: FileVersion | null;
  after: FileVersion | null;
}

export interface ChangeEvent {
  id: string;
  at: string;
  source: ChangeSource;
  changes: FileChange[];
}

type FileTree = Map<string, FileVersion>;

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

function storeDirectory(sessionId: string) {
  if (!uuid.test(sessionId)) throw new Error('无效会话标识');
  return join(hostPorts().paths.userData(), 'chat-files', sessionId);
}
const blobPath = (sessionId: string, hash: string) =>
  join(storeDirectory(sessionId), 'blobs', `${hash}.gz`);
const logPath = (sessionId: string) => join(storeDirectory(sessionId), 'events.jsonl');
const rootDirectory = (sessionId: string, root: Root) =>
  root === 'privacy' ? chatSessionDirectory(sessionId) : chatShareDirectory(sessionId);

function hostPath(sessionId: string, path: string) {
  const [root, ...parts] = path.split('/');
  return join(rootDirectory(sessionId, root as Root), ...parts);
}

const queues = new Map<string, Promise<unknown>>();
function serialized<T>(sessionId: string, work: () => Promise<T>): Promise<T> {
  const next = (queues.get(sessionId) ?? Promise.resolve()).then(work, work);
  queues.set(
    sessionId,
    next.catch(() => {}),
  );
  return next;
}

async function readEvents(sessionId: string): Promise<ChangeEvent[]> {
  let text: string;
  try {
    text = await readFile(logPath(sessionId), 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
  return text
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as ChangeEvent);
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

async function scan(sessionId: string, known: FileTree): Promise<FileTree> {
  const tree: FileTree = new Map();
  for (const root of Object.keys(roots) as Root[]) {
    const base = rootDirectory(sessionId, root);
    const directories = [''];
    while (directories.length) {
      const directory = directories.pop()!;
      for (const entry of await readdir(join(base, directory), { withFileTypes: true })) {
        if (skipped.has(entry.name)) continue;
        if (root === 'privacy' && !directory && privateRuntime.has(entry.name)) continue;
        const name = directory ? `${directory}/${entry.name}` : entry.name;
        if (entry.isDirectory()) directories.push(name);
        else if (entry.isFile()) {
          if (tree.size >= FILE_LIMIT) throw new Error('聊天文件超过 10,000 个，未记录版本');
          const path = `${root}/${name}`;
          tree.set(path, await versionOf(sessionId, join(base, name), known.get(path)));
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

async function appendEvent(sessionId: string, event: ChangeEvent) {
  await mkdir(storeDirectory(sessionId), { recursive: true });
  await appendFile(logPath(sessionId), `${JSON.stringify(event)}\n`);
}

async function record(sessionId: string, source: ChangeSource) {
  const events = await readEvents(sessionId);
  const known = treeAt(events);
  const current = await scan(sessionId, known);
  const changes = changesBetween(known, current);
  const event = changes.length
    ? { id: randomUUID(), at: new Date().toISOString(), source, changes }
    : null;
  if (event) await appendEvent(sessionId, event);
  return { events: event ? [...events, event] : events, current, event };
}

export function recordChatFiles(sessionId: string, source: ChangeSource) {
  return serialized(sessionId, () => record(sessionId, source));
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

export async function freezeChatTurn(
  sessionId: string,
  turnId: string,
  startedAt: string,
  runStatus: TurnChanges['runStatus'],
  unavailableReason?: string,
): Promise<void> {
  const warnings = unavailableReason ? [unavailableReason] : [];
  let event: ChangeEvent | null = null;
  if (!unavailableReason)
    try {
      ({ event } = await recordChatFiles(sessionId, { kind: 'turn', sessionId, turnId }));
    } catch (error) {
      warnings.push(errorText(error));
    }
  const files = [];
  for (const change of event?.changes ?? [])
    if (change.path.startsWith('share/'))
      files.push({
        path: `/${change.path}`,
        before: await storedFile(sessionId, change.before),
        after: await storedFile(sessionId, change.after),
      });
  await saveTurnChanges(
    sessionId,
    {
      turnId,
      cwd: chatShareDirectory(sessionId),
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
  return serialized(sessionId, async () => {
    const { events, current } = await record(sessionId, { kind: 'user' });
    const reverted = new Set(turnIds);
    for (const event of events.toReversed()) {
      if (event.source.kind !== 'turn' || !reverted.has(event.source.turnId)) continue;
      for (const change of event.changes) {
        if ((current.get(change.path)?.hash ?? null) !== (change.after?.hash ?? null)) continue;
        if (change.before && !change.before.stored) continue;
        await restore(sessionId, change.path, change.before);
        if (change.before) current.set(change.path, change.before);
        else current.delete(change.path);
      }
    }
    await record(sessionId, { kind: 'revert', turnIds });
  });
}

export function branchChatFiles(
  sourceId: string,
  targetId: string,
  entryId: string,
  nextTurnId: string | undefined,
  inheritedTurnIds: string[],
) {
  return serialized(sourceId, async () => {
    let events = await readEvents(sourceId);
    const next = events.findIndex(
      (event) => event.source.kind === 'turn' && event.source.turnId === nextTurnId,
    );
    let tree: FileTree;
    if (next >= 0) tree = treeAt(events.slice(0, next));
    else ({ events, current: tree } = await record(sourceId, { kind: 'user' }));
    const inherited = events.filter(
      (event) => event.source.kind === 'turn' && inheritedTurnIds.includes(event.source.turnId),
    );
    for (const version of inherited.flatMap((event) =>
      event.changes.flatMap(({ before, after }) => [before, after]),
    ))
      if (version?.stored) {
        const target = blobPath(targetId, version.hash);
        await mkdir(dirname(target), { recursive: true });
        await copyFile(blobPath(sourceId, version.hash), target);
      }
    const changes: FileChange[] = [];
    for (const [path, version] of tree) {
      const target = hostPath(targetId, path);
      await mkdir(dirname(target), { recursive: true });
      if (version.stored) await writeFile(target, await readBlob(sourceId, version.hash));
      else {
        const source = hostPath(sourceId, path);
        const info = await lstat(source).catch(() => null);
        if (!info?.isFile() || `size:${info.size}:${info.mtimeMs}` !== version.hash) continue;
        await copyFile(source, target);
      }
      await chmod(target, version.mode);
      changes.push({ path, before: null, after: await versionOf(targetId, target, undefined) });
    }
    await mkdir(storeDirectory(targetId), { recursive: true });
    await writeFile(
      logPath(targetId),
      [
        ...inherited,
        {
          id: randomUUID(),
          at: new Date().toISOString(),
          source: { kind: 'branch', sessionId: sourceId, entryId },
          changes,
        },
      ]
        .map((event) => `${JSON.stringify(event)}\n`)
        .join(''),
    );
  });
}

export async function deleteChatFiles(sessionId: string): Promise<void> {
  await serialized(sessionId, () =>
    rm(storeDirectory(sessionId), { recursive: true, force: true }),
  );
  queues.delete(sessionId);
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

export async function chatFileHistory(sessionId: string, path: string, refresh: boolean) {
  const events = refresh
    ? (await recordChatFiles(sessionId, { kind: 'user' })).events
    : await readEvents(sessionId);
  return events.flatMap((event) => {
    const change = event.changes.find((change) => change.path === path);
    return change ? [{ event, change }] : [];
  });
}

export async function readChatFileVersion(
  sessionId: string,
  eventId: string,
  path: string,
): Promise<FileChangeDetail> {
  const change = (await readEvents(sessionId))
    .find((event) => event.id === eventId)
    ?.changes.find((change) => change.path === path);
  if (!change) throw new Error('这个版本没有此文件的记录');
  return storedFileChange({
    path,
    before: await storedFile(sessionId, change.before),
    after: await storedFile(sessionId, change.after),
  });
}
