import { describe, expect, it, vi } from 'vitest';
import { join } from 'node:path';

const systemPaths = [
  join(process.env.WINDIR ?? 'C:\\Windows', 'System32', 'OpenSSH', 'ssh.exe'),
  join(process.env.ProgramFiles ?? 'C:\\Program Files', 'OpenSSH', 'ssh.exe'),
];

vi.mock('electron', () => ({
  app: { isPackaged: false, getAppPath: () => process.cwd(), getPath: () => process.cwd() },
}));
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    existsSync: (path: Parameters<typeof actual.existsSync>[0]) =>
      systemPaths.includes(String(path)) ? false : actual.existsSync(path),
  };
});

import { exec } from '../../../src/core/remote/transport';

describe('自带 ssh 回退（真机）', () => {
  it('用自带的客户端真连一次远端', async () => {
    const result = await exec(
      { host: process.env.DELION_REMOTE_HOST!, keyPath: process.env.DELION_REMOTE_KEY ?? null },
      'echo bundled-ok',
    );
    expect(result.stdout.toString().trim()).toBe('bundled-ok');
    expect(result.code).toBe(0);
  }, 60_000);
});
