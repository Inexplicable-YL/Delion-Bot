import { spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const output = join(root, '.build', 'scopedfs');
const name = process.platform === 'win32' ? 'scopedfs.exe' : 'scopedfs';
mkdirSync(output, { recursive: true });
const result = spawnSync('go', ['build', '-trimpath', '-o', join(output, name), '.'], {
  cwd: join(root, 'helper', 'scopedfs'),
  env: { ...process.env, CGO_ENABLED: '0' },
  stdio: 'inherit',
  windowsHide: true,
});
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
