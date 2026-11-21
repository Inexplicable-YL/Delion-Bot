import { app, session } from 'electron';
import { lstat, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import type { CacheClearResult } from '../contract';

export const cacheDirectoryNames = new Set([
  'Cache',
  'Code Cache',
  'GPUCache',
  'DawnGraphiteCache',
  'DawnWebGPUCache',
  'ShaderCache',
  'GrShaderCache',
  'CacheStorage',
  'ScriptCache',
  'Crashpad',
  'logs',
]);

async function treeBytes(directory: string): Promise<number> {
  let total = 0;
  for (const name of await readdir(directory)) {
    const path = join(directory, name);
    try {
      const info = await lstat(path);
      if (info.isSymbolicLink()) continue;
      total += info.isDirectory() ? await treeBytes(path) : info.size;
    } catch {}
  }
  return total;
}

async function cacheBytes(directory: string): Promise<number> {
  let total = 0;
  for (const name of await readdir(directory)) {
    const path = join(directory, name);
    try {
      const info = await lstat(path);
      if (info.isSymbolicLink() || !info.isDirectory()) continue;
      total += cacheDirectoryNames.has(name) ? await treeBytes(path) : await cacheBytes(path);
    } catch {}
  }
  return total;
}

async function removeCaches(directory: string): Promise<boolean> {
  let names: string[];
  try {
    names = await readdir(directory);
  } catch {
    return true;
  }
  let blocked = false;
  for (const name of names) {
    const path = join(directory, name);
    try {
      const info = await lstat(path);
      if (info.isSymbolicLink() || !info.isDirectory()) continue;
      if (cacheDirectoryNames.has(name)) await rm(path, { recursive: true, force: true });
      else blocked = (await removeCaches(path)) || blocked;
    } catch {
      blocked = true;
    }
  }
  return blocked;
}

async function releaseSessions() {
  const partitions = await readdir(join(app.getPath('userData'), 'Partitions')).catch(() => []);
  for (const partition of [undefined, ...partitions.map((name) => `persist:${name}`)]) {
    const target = partition ? session.fromPartition(partition) : session.defaultSession;
    await Promise.all([
      target.clearCache(),
      target.clearCodeCaches({}),
      target.clearStorageData({ storages: ['cachestorage', 'shadercache'] }),
    ]).catch(() => {});
  }
}

export function cacheSize(): Promise<number> {
  return cacheBytes(app.getPath('userData'));
}

export async function clearCaches(): Promise<CacheClearResult> {
  const root = app.getPath('userData');
  const before = await cacheSize();
  await releaseSessions();
  const blocked = await removeCaches(root);
  return { freed: Math.max(0, before - (await cacheSize())), blocked };
}
