import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const state = vi.hoisted(() => ({
  root: '',
  documents: '',
  home: '',
  picked: { canceled: false, filePaths: [] as string[] },
  failOn: '',
}));

vi.mock('electron', () => ({
  app: {
    getPath: (name: string) => {
      if (name === 'documents') return state.documents;
      if (name === 'home') return state.home;
      return state.root;
    },
    getVersion: () => '1.1.0',
    isPackaged: false,
  },
  ipcMain: { handle: () => undefined },
  dialog: { showOpenDialog: async () => state.picked },
  BrowserWindow: { fromWebContents: () => null },
}));

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...actual,
    cp: async (
      source: Parameters<typeof actual.cp>[0],
      target: Parameters<typeof actual.cp>[1],
      options?: Parameters<typeof actual.cp>[2],
    ) => {
      if (state.failOn && String(source).includes(state.failOn)) throw new Error('EBUSY');
      return actual.cp(source, target, options);
    },
  };
});

import type { BackupResult } from '../../../../src/modules/settings/contract';
import { exportUserData } from '../../../../src/modules/settings/main/backup';
import { provideTestHostPorts } from '../../../core/host-mock';
import { closeDatabase, getDatabase, SCHEMA_VERSION } from '../../../../src/app/main/database';

let base: string;
let userData: string;
let pickedDirectory: string;

function exported(result: BackupResult): Extract<BackupResult, { status: 'exported' }> {
  if (result.status !== 'exported') throw new Error('这一步应当导出成功');
  return result;
}

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), 'delion-backup-'));
  state.documents = join(base, 'documents');
  pickedDirectory = join(base, '选定的位置');
  mkdirSync(pickedDirectory, { recursive: true });
  state.picked = { canceled: false, filePaths: [pickedDirectory] };
  state.failOn = '';

  userData = join(base, 'userData');
  state.root = userData;
  for (const cache of [
    join('Cache', 'x'),
    join('Code Cache', 'y'),
    join('Partitions', 'sample-partition', 'Code Cache', 'z'),
  ]) {
    mkdirSync(join(userData, cache), { recursive: true });
    writeFileSync(join(userData, cache, 'big.bin'), 're-generable');
  }
  mkdirSync(join(userData, 'Partitions', 'sample-partition', 'Local Storage', 'leveldb'), {
    recursive: true,
  });
  writeFileSync(
    join(userData, 'Partitions', 'sample-partition', 'Local Storage', 'leveldb', 'w.ldb'),
    'keep',
  );
  mkdirSync(join(userData, 'pi', 'sessions'), { recursive: true });
  writeFileSync(join(userData, 'pi', 'sessions', 'a.jsonl'), 'keep');
  mkdirSync(join(state.documents, 'Delion Bot'), { recursive: true });
  writeFileSync(join(state.documents, 'Delion Bot', 'note.txt'), 'keep');
  state.home = join(base, 'home');
  provideTestHostPorts({
    paths: {
      userData: () => state.root,
      home: () => state.home,
      documents: () => state.documents,
      storage: () => join(state.documents, 'Delion Bot'),
    },
    database: getDatabase,
  });
  mkdirSync(join(state.home, '.delion-bot', 'skills', 'mine'), { recursive: true });
  writeFileSync(join(state.home, '.delion-bot', 'skills', 'mine', 'SKILL.md'), 'keep');
});

afterEach(() => {
  closeDatabase();
  rmSync(base, { recursive: true, force: true });
});

it('跳过可再生缓存、保留用户数据，并给数据库取一致快照', async () => {
  getDatabase()
    .prepare(
      `INSERT INTO consent_records (document, revision, app_version, accepted_at)
       VALUES ('terms', '2026-10-15', '1.1.0', '2026-10-15T09:00:00.000Z')`,
    )
    .run();
  expect(existsSync(join(userData, 'delion.db-wal'))).toBe(true);

  const result = exported(await exportUserData(null));
  expect(result.path).toMatch(/Delion Bot 备份 \d{4}-\d{2}-\d{2} \d{2}-\d{2}$/);
  expect(result.skipped).toEqual([]);
  const data = join(result.path, '应用数据');

  for (const cache of ['Cache', 'Code Cache', join('Partitions', 'sample-partition', 'Code Cache')])
    expect(existsSync(join(data, cache))).toBe(false);
  expect(
    existsSync(join(data, 'Partitions', 'sample-partition', 'Local Storage', 'leveldb', 'w.ldb')),
  ).toBe(true);
  expect(existsSync(join(data, 'pi', 'sessions', 'a.jsonl'))).toBe(true);
  expect(existsSync(join(result.path, '工作目录', 'note.txt'))).toBe(true);
  expect(existsSync(join(result.path, '技能', 'mine', 'SKILL.md'))).toBe(true);

  expect(existsSync(join(data, 'delion.db-wal'))).toBe(false);
  expect(existsSync(join(data, 'delion.db-shm'))).toBe(false);
  const snapshot = new Database(join(data, 'delion.db'), { readonly: true });
  try {
    expect(snapshot.pragma('user_version', { simple: true })).toBe(SCHEMA_VERSION);
    expect(snapshot.prepare('SELECT COUNT(*) AS count FROM consent_records').get()).toEqual({
      count: 1,
    });
  } finally {
    snapshot.close();
  }
});

it('同一分钟重复导出不覆盖已有备份', async () => {
  const first = exported(await exportUserData(null));
  const second = exported(await exportUserData(null));

  expect(second.path).not.toBe(first.path);
  expect(existsSync(join(first.path, '应用数据', 'delion.db'))).toBe(true);
  expect(existsSync(join(second.path, '应用数据', 'delion.db'))).toBe(true);
});

it('目标落在数据目录里面时直接拒绝，不在源目录里建备份文件夹', async () => {
  state.picked = { canceled: false, filePaths: [userData] };

  const result = await exportUserData(null);

  expect(result).toMatchObject({ status: 'failed', reason: expect.stringContaining('数据目录') });
  expect(readdirSync(userData).filter((name) => name.startsWith('Delion Bot 备份'))).toEqual([]);
});

it('单个条目复制失败不影响其余条目，名字如实回报', async () => {
  state.failOn = 'Partitions';

  const result = exported(await exportUserData(null));

  expect(result.skipped).toEqual(['Partitions']);
  expect(existsSync(join(result.path, '应用数据', 'pi', 'sessions', 'a.jsonl'))).toBe(true);
  expect(existsSync(join(result.path, '应用数据', 'delion.db'))).toBe(true);
  expect(existsSync(join(result.path, '应用数据', 'Partitions'))).toBe(false);
});
