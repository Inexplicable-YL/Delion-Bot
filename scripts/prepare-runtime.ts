import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  copyFileSync,
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';

if (process.platform === 'darwin') {
  console.log('macOS 使用系统 Bash / Git 与 vendor/bin 下的对应架构搜索工具，无需 MinGit。');
  process.exit(0);
}

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, '.build', 'mingit');
const marker = join(root, '.build', 'mingit.prepared');

const version = '2.56.0.2';
const sha256 = 'da35e72aa21c005a5a0d298cfbae110bc1609a815730ea0dde84b01a1b3cd3be';
const urls = [
  'https://registry.npmmirror.com/-/binary/git-for-windows/v2.56.0.windows.2/MinGit-2.56.0.2-64-bit.zip',
  'https://github.com/git-for-windows/git/releases/download/v2.56.0.windows.2/MinGit-2.56.0.2-64-bit.zip',
];

const fingerprint = `${version} ${sha256}`;
if (
  existsSync(marker) &&
  readFileSync(marker, 'utf8').trim() === fingerprint &&
  existsSync(join(outDir, 'usr', 'bin', 'bash.exe'))
) {
  console.log(`MinGit ${version} 已就绪，跳过下载。`);
  process.exit(0);
}

rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });
const archive = join(outDir, 'mingit.zip');
const failures: string[] = [];
let downloaded = false;
for (const url of urls) {
  try {
    console.log(`下载 ${url}`);
    const response = await fetch(url, { redirect: 'follow' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    if (!response.body) throw new Error('下载没有返回内容');
    const hash = createHash('sha256');
    await pipeline(
      Readable.fromWeb(response.body),
      async function* (chunks) {
        for await (const chunk of chunks) {
          hash.update(chunk);
          yield chunk;
        }
      },
      createWriteStream(archive),
    );
    const actual = hash.digest('hex');
    if (actual !== sha256) throw new Error(`SHA256 不符（${actual.slice(0, 12)}…）`);
    downloaded = true;
    break;
  } catch (cause) {
    failures.push(`${new URL(url).host}：${cause instanceof Error ? cause.message : cause}`);
    rmSync(archive, { force: true });
  }
}
if (!downloaded) {
  console.error(`下载失败（${failures.join('；')}）`);
  process.exit(1);
}

const tar = join(process.env.windir ?? 'C:\\Windows', 'System32', 'tar.exe');
const extract = spawnSync(tar, ['-xf', archive, '-C', outDir], { stdio: 'inherit' });
if (extract.status !== 0) process.exit(extract.status ?? 1);
rmSync(archive, { force: true });

copyFileSync(join(outDir, 'usr', 'bin', 'sh.exe'), join(outDir, 'usr', 'bin', 'bash.exe'));
for (const must of [join('usr', 'bin', 'bash.exe'), join('cmd', 'git.exe')]) {
  if (!existsSync(join(outDir, must))) {
    console.error(`解压结果缺少 ${must}`);
    process.exit(1);
  }
}
mkdirSync(dirname(marker), { recursive: true });
writeFileSync(marker, fingerprint);
console.log(`MinGit ${version} 已就绪：${outDir}`);
