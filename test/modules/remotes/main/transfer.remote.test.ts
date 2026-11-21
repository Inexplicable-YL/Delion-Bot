import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getAppPath: () => process.cwd(),
    getPath: () => tmpdir(),
  },
  shell: { openPath: vi.fn(async () => ''), showItemInFolder: vi.fn() },
}));

import {
  closeRemoteOpens,
  downloadRemoteFile,
  openRemoteFile,
  uploadLocalFile,
} from '../../../../src/modules/remotes/main/transfer';
import { readRemoteRange, statRemoteFile } from '../../../../src/core/remote/operations';
import type { RemoteTarget } from '../../../../src/core/remote/transport';

const target: RemoteTarget = {
  host: process.env.DELION_REMOTE_HOST!,
  keyPath: process.env.DELION_REMOTE_KEY ?? null,
};
const root = '/tmp/delion-transfer-test';
const local = mkdtempSync(join(tmpdir(), 'delion-transfer-'));

afterAll(() => rmSync(local, { recursive: true, force: true }));

describe('远端文件传输（真机）', () => {
  it('二进制上传与下载：字节逐个相同，大小与 sha256 都对得上', async () => {
    const payload = Buffer.concat([randomBytes(3 * 1024 * 1024 + 7), Buffer.from([0, 255, 10])]);
    const source = join(local, 'bin.dat');
    writeFileSync(source, payload);
    const digest = createHash('sha256').update(payload).digest('hex');

    const remotePath = await uploadLocalFile(target, source, root);
    expect(remotePath).toBe(`${root}/bin.dat`);
    const stat = await statRemoteFile(target, remotePath);
    expect(stat.size).toBe(payload.length);

    const back = join(local, 'back.dat');
    await downloadRemoteFile(target, remotePath, back);
    const restored = readFileSync(back);
    expect(restored.length).toBe(payload.length);
    expect(createHash('sha256').update(restored).digest('hex')).toBe(digest);

    const tail = await readRemoteRange(target, remotePath, payload.length - 3, 3);
    expect([...tail]).toEqual([0, 255, 10]);
    expect((await readRemoteRange(target, remotePath, 0, 10)).length).toBe(10);
  }, 180_000);

  it('用系统默认程序打开：先下到临时目录，退出清理（shell 在这里是替身，不真开程序）', async () => {
    const source = join(local, 'open.txt');
    writeFileSync(source, '打开我\n');
    const remotePath = await uploadLocalFile(target, source, root);

    await openRemoteFile(target, remotePath);
    const { openPath } = await import('electron').then((m) => m.shell);
    const opened = vi.mocked(openPath).mock.calls.at(-1)?.[0] ?? '';
    expect(opened).toContain(join('delion-remote-open', ''));
    expect(opened.endsWith('-open.txt')).toBe(true);
    expect(readFileSync(opened, 'utf8')).toBe('打开我\n');

    await closeRemoteOpens();
    expect(existsSync(opened)).toBe(false);
  }, 180_000);
});
