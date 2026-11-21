import { afterEach, describe, expect, it, vi } from 'vitest';
import { join } from 'node:path';

const bundled = join(process.cwd(), 'vendor', 'openssh', 'ssh.exe');
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

import { locateSsh } from '../../../src/core/remote/transport';

afterEach(() => vi.unstubAllGlobals());

describe('自带 ssh 回退', () => {
  it('系统没有 OpenSSH 时定位到自带的那份', () => {
    vi.stubGlobal('process', { ...process, platform: 'win32' });
    expect(locateSsh()).toBe(bundled);
  });
});
