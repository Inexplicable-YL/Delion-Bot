import { spawn, spawnSync } from 'node:child_process';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { hostPorts } from '../../ports';
import type { SandboxRoots } from './mode';

const OUTPUT_LIMIT = 1024 * 1024;
const FRESH_MOUNTS = ['/tmp', '/var/tmp', '/run', '/dev/shm'];
const SKIP_ROOTS = new Set(['proc', 'sys', 'dev', 'run', 'tmp', 'privacy', 'delivery']);

export interface SandboxResult {
  code: number;
  stdout: Buffer;
  stderr: string;
  truncated: boolean;
}

export interface SandboxRunOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
  stdin?: Buffer;
  cwd?: string;
  onData?: (chunk: Buffer) => void;
}

type Availability = { ok: true } | { ok: false; reason: string };

let availability: Availability | undefined;
let bwrapBinary: string | undefined;

export function sandboxUnavailableReason(platform: NodeJS.Platform, detail: string): string {
  if (platform !== 'linux')
    return `${platform} 尚未提供经过验证的受限沙箱。普通对话不能以受限模式运行，也没有改用本机权限。Windows 和 macOS 都在此列。可在对话菜单把文件权限改为「完全权限」。${detail}`;
  return `受限模式无法启动，已停止执行，没有改用当前用户的本机权限。${detail}可在对话菜单的「文件权限」中显式改为完全权限。`;
}

function fail(reason: string): Availability {
  return { ok: false, reason: sandboxUnavailableReason(process.platform, reason) };
}

function findBwrap(): string | null {
  if (bwrapBinary) return bwrapBinary;
  const found = spawnSync('which', ['bwrap'], { encoding: 'utf8' });
  const path = found.status === 0 ? found.stdout.trim() : '';
  if (!path) return null;
  bwrapBinary = path;
  return path;
}

function probe(binary: string): Availability {
  const result = spawnSync(
    binary,
    [
      '--die-with-parent',
      '--unshare-user',
      '--unshare-net',
      '--disable-userns',
      '--tmpfs',
      '/',
      '--ro-bind',
      '/usr',
      '/usr',
      '--symlink',
      'usr/bin',
      '/bin',
      '--symlink',
      'usr/lib',
      '/lib',
      '--symlink',
      'usr/lib64',
      '/lib64',
      '--',
      '/usr/bin/python3',
      '-c',
      'print(1)',
    ],
    { encoding: 'utf8', timeout: 8000 },
  );
  if (result.error) return fail(`bubblewrap 未能运行：${result.error.message}。`);
  if (result.status !== 0)
    return fail(
      `bubblewrap 未能建立隔离：${(result.stderr || result.stdout || '未知错误').trim().slice(0, 400)}。`,
    );
  return { ok: true };
}

export function linuxSandboxAvailability(): Availability {
  if (availability) return availability;
  if (process.platform !== 'linux') {
    availability = fail('当前系统没有已验证的隔离后端。');
    return availability;
  }
  const binary = findBwrap();
  if (!binary) {
    availability = fail('未找到 bubblewrap（bwrap）。');
    return availability;
  }
  if (!existsSync('/usr/bin/python3') || !existsSync('/usr/bin/bash')) {
    availability = fail('隔离环境缺少 /usr/bin/python3 或 /usr/bin/bash。');
    return availability;
  }
  availability = probe(binary);
  return availability;
}

export function assertLinuxSandbox(): void {
  const result = linuxSandboxAvailability();
  if (!result.ok) throw new Error(result.reason);
}

function under(parent: string, child: string): boolean {
  const rel = relative(parent, child);
  return rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel));
}

function hiddenDirectories(): string[] {
  const candidates = [
    hostPorts().paths.userData(),
    resolve(hostPorts().paths.storage(), 'chat-sessions'),
    resolve(hostPorts().paths.storage(), 'chat-delivery'),
    resolve(hostPorts().paths.home(), '.delion-bot'),
    resolve(hostPorts().paths.temp(), 'delion-document-reading'),
  ]
    .map((path) => resolve(path))
    .filter((path) => existsSync(path) && lstatSync(path).isDirectory())
    .filter((path) => !FRESH_MOUNTS.some((mount) => under(mount, path)));
  const kept: string[] = [];
  for (const path of candidates.sort((a, b) => a.length - b.length))
    if (!kept.some((parent) => under(parent, path))) kept.push(path);
  return kept;
}

function rootMounts(): string[] {
  const args: string[] = [];
  for (const name of readdirSync('/')) {
    if (SKIP_ROOTS.has(name)) continue;
    const source = `/${name}`;
    let info: ReturnType<typeof lstatSync>;
    try {
      info = lstatSync(source);
    } catch {
      continue;
    }
    if (info.isSymbolicLink()) {
      args.push('--symlink', readlinkSync(source), source);
      continue;
    }
    if (info.isDirectory()) args.push('--ro-bind-try', source, source);
  }
  return args;
}

let socketMask: string | undefined;

function socketMaskFile(): string {
  if (socketMask && existsSync(socketMask)) return socketMask;
  const dir = join(tmpdir(), 'delion-socket-mask');
  mkdirSync(dir, { recursive: true });
  socketMask = join(dir, 'none');
  writeFileSync(socketMask, '');
  return socketMask;
}

function socketMaskArgs(): string[] {
  const found = spawnSync(
    'find',
    [
      '/',
      '-xdev',
      '(',
      '-path',
      '/proc',
      '-o',
      '-path',
      '/sys',
      '-o',
      '-path',
      '/dev',
      ')',
      '-prune',
      '-o',
      '-xtype',
      's',
      '-print0',
    ],
    { timeout: 8000, maxBuffer: 8 * 1024 * 1024 },
  );
  if (found.error || (found.status !== 0 && found.status !== 1))
    throw new Error('无法枚举宿主套接字，已停止执行，没有改用当前用户的本机权限。');
  const covered = [...FRESH_MOUNTS, ...hiddenDirectories()];
  const dummy = socketMaskFile();
  const args: string[] = [];
  for (const path of found.stdout.toString('utf8').split('\0')) {
    if (!path.startsWith('/')) continue;
    if (covered.some((parent) => under(parent, path))) continue;
    args.push('--ro-bind-try', dummy, path);
  }
  return args;
}

function sandboxArgs(roots: SandboxRoots, cwd: string, file: string, args: string[]): string[] {
  return [
    '--die-with-parent',
    '--unshare-user',
    '--unshare-net',
    '--unshare-pid',
    '--unshare-ipc',
    '--unshare-uts',
    '--disable-userns',
    '--hostname',
    'sandbox',
    '--tmpfs',
    '/',
    ...rootMounts(),
    '--dir',
    '/privacy',
    '--dir',
    '/delivery',
    '--dir',
    '/tmp',
    '--dir',
    '/run',
    '--dir',
    '/proc',
    '--dir',
    '/dev',
    '--tmpfs',
    '/tmp',
    '--tmpfs',
    '/run',
    '--tmpfs',
    '/dev/shm',
    '--tmpfs',
    '/var/tmp',
    ...hiddenDirectories().flatMap((path) => ['--tmpfs', path]),
    ...socketMaskArgs(),
    '--bind',
    roots.privacyHost,
    '/privacy',
    '--bind',
    roots.deliveryHost,
    '/delivery',
    '--dev',
    '/dev',
    '--chdir',
    cwd,
    '--clearenv',
    '--setenv',
    'PATH',
    '/usr/bin:/bin',
    '--setenv',
    'HOME',
    '/privacy/.home',
    '--setenv',
    'TMPDIR',
    '/tmp',
    '--setenv',
    'XDG_CACHE_HOME',
    '/privacy/.cache',
    '--setenv',
    'LANG',
    'C',
    '--',
    file,
    ...args,
  ];
}

export function runSandboxed(
  roots: SandboxRoots,
  file: string,
  args: string[],
  options: SandboxRunOptions = {},
): Promise<SandboxResult> {
  assertLinuxSandbox();
  const binary = findBwrap();
  const ready = linuxSandboxAvailability();
  if (!binary || !ready.ok)
    throw new Error(ready.ok ? '未找到 bubblewrap（bwrap）。' : ready.reason);
  const cwd = options.cwd ?? '/privacy';
  return new Promise((resolvePromise, reject) => {
    const child = spawn(binary, sandboxArgs(roots, cwd, file, args), {
      stdio: ['pipe', 'pipe', 'pipe'],
      detached: process.platform !== 'win32',
      windowsHide: true,
    });
    child.stdin?.on('error', () => {});
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let size = 0;
    let truncated = false;
    let settled = false;
    const finish = (code: number) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', stop);
      resolvePromise({
        code,
        stdout: Buffer.concat(stdout),
        stderr: Buffer.concat(stderr).toString('utf8'),
        truncated,
      });
    };
    const stop = () => {
      if (child.pid && process.platform !== 'win32') {
        try {
          process.kill(-child.pid, 'SIGKILL');
          return;
        } catch {
          child.kill('SIGKILL');
          return;
        }
      }
      child.kill('SIGKILL');
    };
    const timer = options.timeoutMs
      ? setTimeout(() => {
          truncated = true;
          stop();
        }, options.timeoutMs)
      : undefined;
    if (options.signal) {
      if (options.signal.aborted) stop();
      else options.signal.addEventListener('abort', stop, { once: true });
    }
    const take = (chunk: Buffer, target: Buffer[]) => {
      if (size >= OUTPUT_LIMIT) {
        truncated = true;
        stop();
        return;
      }
      const room = OUTPUT_LIMIT - size;
      const slice = chunk.byteLength > room ? chunk.subarray(0, room) : chunk;
      if (slice.byteLength !== chunk.byteLength) truncated = true;
      size += slice.byteLength;
      target.push(slice);
      options.onData?.(slice);
    };
    child.stdout?.on('data', (chunk: Buffer) => take(chunk, stdout));
    child.stderr?.on('data', (chunk: Buffer) => take(chunk, stderr));
    child.once('error', (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    });
    child.once('close', (code) => finish(code ?? 1));
    if (options.stdin) child.stdin?.end(options.stdin);
    else child.stdin?.end();
  });
}
