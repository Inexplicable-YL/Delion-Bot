import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const output = join(root, '.build', 'scopedfs');
const name = process.platform === 'win32' ? 'scopedfs.exe' : 'scopedfs';
const localGo = join(root, '.tools', 'go', 'bin', process.platform === 'win32' ? 'go.exe' : 'go');
const go = existsSync(localGo) ? localGo : 'go';
mkdirSync(output, { recursive: true });
const result = spawnSync(go, ['build', '-trimpath', '-o', join(output, name), '.'], {
  cwd: join(root, 'helper', 'scopedfs'),
  env: { ...process.env, CGO_ENABLED: '0' },
  stdio: 'inherit',
  windowsHide: true,
});
if (result.error?.code === 'ENOENT') {
  console.error('未找到 Go。请安装 Go 1.25 或更高版本，并把 go 加到 PATH。');
} else if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
