import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ failRemove: false, root: '' }));

vi.mock('electron', () => {
  const fakeSession = () => ({
    clearCache: vi.fn(async () => {}),
    clearCodeCaches: vi.fn(async () => {}),
    clearStorageData: vi.fn(async () => {}),
  });
  return {
    app: { getPath: () => state.root },
    ipcMain: { handle: vi.fn() },
    session: { defaultSession: fakeSession(), fromPartition: vi.fn(() => fakeSession()) },
  };
});

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...actual,
    rm: vi.fn(
      async (path: Parameters<typeof actual.rm>[0], options?: Parameters<typeof actual.rm>[1]) => {
        if (state.failRemove) throw new Error('EBUSY');
        return actual.rm(path, options);
      },
    ),
  };
});

import { cacheSize, clearCaches } from '../../../../src/modules/settings/main/cache';

function write(path: string, size: number) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, Buffer.alloc(size));
}

beforeEach(() => {
  state.failRemove = false;
  state.root = mkdtempSync(join(tmpdir(), 'delion-cache-'));
  write(join(state.root, 'Cache', 'Cache_Data', 'a.bin'), 1000);
  write(join(state.root, 'Code Cache', 'js', 'b.js'), 2000);
  write(join(state.root, 'Partitions', 'sample-partition', 'Cache', 'c.bin'), 500);
  write(
    join(state.root, 'Partitions', 'sample-partition', 'Local Storage', 'leveldb', 'd.lld'),
    700,
  );
  write(join(state.root, 'Local Storage', 'leveldb', 'e.lld'), 4000);
  write(join(state.root, 'misc', 'Cache'), 700);
  write(join(state.root, 'delion.db'), 8000);
});

afterEach(() => {
  rmSync(state.root, { recursive: true, force: true });
  vi.clearAllMocks();
});

it('按目录名统计缓存占用，用户数据、数据库与同名文件都不算', async () => {
  await expect(cacheSize()).resolves.toBe(3500);
});

it('符号链接（junction）不跟，避免量到目录树外面去', async () => {
  const link = join(state.root, 'misc', 'CacheLink');
  try {
    symlinkSync(join(state.root, 'Cache'), link, 'junction');
  } catch {
    return;
  }
  await expect(cacheSize()).resolves.toBe(3500);
  const result = await clearCaches();
  expect(result.freed).toBe(3500);
  expect(existsSync(join(state.root, 'Local Storage', 'leveldb', 'e.lld'))).toBe(true);
});

it('清除只删缓存目录，其余文件原地不动', async () => {
  await expect(clearCaches()).resolves.toEqual({ freed: 3500, blocked: false });

  expect(await cacheSize()).toBe(0);
  expect(existsSync(join(state.root, 'Cache'))).toBe(false);
  expect(existsSync(join(state.root, 'Code Cache'))).toBe(false);
  expect(existsSync(join(state.root, 'Partitions', 'sample-partition', 'Cache'))).toBe(false);
  expect(existsSync(join(state.root, 'Partitions', 'sample-partition', 'Local Storage'))).toBe(
    true,
  );
  expect(existsSync(join(state.root, 'Local Storage', 'leveldb', 'e.lld'))).toBe(true);
  expect(existsSync(join(state.root, 'misc', 'Cache'))).toBe(true);
  expect(statSync(join(state.root, 'delion.db')).size).toBe(8000);
});

it('有文件删不掉时如实回报 blocked', async () => {
  state.failRemove = true;
  const result = await clearCaches();
  expect(result.blocked).toBe(true);
  expect(result.freed).toBe(0);
  expect(existsSync(join(state.root, 'Cache'))).toBe(true);
});
