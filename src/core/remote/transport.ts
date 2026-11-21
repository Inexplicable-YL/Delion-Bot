import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { hostPorts } from '../ports';

export interface RemoteTarget {
  host: string;
  port?: number | null;
  keyPath?: string | null;
}

export function targetKey(target: RemoteTarget): string {
  return `${target.host}|${target.port ?? ''}|${target.keyPath ?? ''}`;
}

interface ExecOptions {
  stdin?: Buffer | string;
  onStdinProgress?: (sent: number, total: number) => void;
  signal?: AbortSignal;
  timeoutMs?: number;
}

interface ExecResult {
  code: number;
  stdout: Buffer;
  stderr: string;
}

export interface RemoteDirEntry {
  name: string;
  directory: boolean;
  size: number | null;
  modifiedAt: number | null;
}

const DEFAULT_TIMEOUT_MS = 120_000;
const CONNECT_TIMEOUT_SECONDS = 10;
const KEEPALIVE_SECONDS = 15;
const KEEPALIVE_COUNT_MAX = 3;

function binaryCandidates(binary: 'ssh' | 'sftp'): string[] {
  if (process.platform === 'darwin') return [join('/usr/bin', binary)];
  const name = `${binary}.exe`;
  const bundledRoot = hostPorts().paths.bundled('openssh');
  return [
    join(process.env.WINDIR ?? 'C:\\Windows', 'System32', 'OpenSSH', name),
    join(process.env.ProgramFiles ?? 'C:\\Program Files', 'OpenSSH', name),
    join(bundledRoot, name),
  ];
}

const located = new Map<string, string>();

export function locateSsh(binary: 'ssh' | 'sftp' = 'ssh'): string {
  const cached = located.get(binary);
  if (cached) return cached;
  const found = binaryCandidates(binary).find((path) => existsSync(path));
  if (!found)
    throw new Error(
      process.platform === 'darwin'
        ? `未找到 macOS 系统 SSH 客户端（/usr/bin/${binary}），请检查系统环境`
        : '未找到 SSH 客户端：请在「设置 › 应用 › 可选功能」安装 OpenSSH 客户端，或把 openssh 目录放到 Delion Bot 资源目录后重试',
    );
  located.set(binary, found);
  return found;
}

export function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

export function sshBaseArguments(target: RemoteTarget): string[] {
  const args = [
    '-o',
    'BatchMode=yes',
    '-o',
    `ConnectTimeout=${CONNECT_TIMEOUT_SECONDS}`,
    '-o',
    `ServerAliveInterval=${KEEPALIVE_SECONDS}`,
    '-o',
    `ServerAliveCountMax=${KEEPALIVE_COUNT_MAX}`,
  ];
  if (target.port) args.push('-p', String(target.port));
  if (target.keyPath) args.push('-i', target.keyPath);
  return args;
}

function sshArguments(target: RemoteTarget, command: string): string[] {
  return [...sshBaseArguments(target), target.host, command];
}

export function exec(
  target: RemoteTarget,
  command: string,
  options: ExecOptions = {},
): Promise<ExecResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(locateSsh(), sshArguments(target, command), {
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const chunks: Buffer[] = [];
    const errors: Buffer[] = [];
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    const onAbort = () => child.kill();
    options.signal?.addEventListener('abort', onAbort, { once: true });

    const finish = (result: ExecResult) => {
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', onAbort);
      resolve(result);
    };

    child.stdout.on('data', (chunk: Buffer) => chunks.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => errors.push(chunk));
    child.on('error', (error) => {
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', onAbort);
      reject(error);
    });
    child.on('close', (code) => {
      const stderr = Buffer.concat(errors).toString();
      if (timedOut) {
        finish({ code: 124, stdout: Buffer.concat(chunks), stderr: `命令超时未结束\n${stderr}` });
        return;
      }
      finish({ code: code ?? 1, stdout: Buffer.concat(chunks), stderr });
    });

    if (options.stdin === undefined) child.stdin.end();
    else if (!options.onStdinProgress) child.stdin.end(options.stdin);
    else void writeChunked(child.stdin, Buffer.from(options.stdin), options.onStdinProgress);
  });
}

const STDIN_CHUNK = 64 * 1024;

async function writeChunked(
  stream: NodeJS.WritableStream,
  body: Buffer,
  onProgress: (sent: number, total: number) => void,
): Promise<void> {
  for (let offset = 0; offset < body.length; offset += STDIN_CHUNK) {
    const chunk = body.subarray(offset, offset + STDIN_CHUNK);
    if (!stream.write(chunk))
      await new Promise<void>((resolve) => {
        const done = () => {
          stream.off('drain', done);
          stream.off('close', done);
          resolve();
        };
        stream.on('drain', done);
        stream.on('close', done);
      });
    onProgress(Math.min(offset + chunk.length, body.length), body.length);
  }
  stream.end();
}

export function sshErrorMessage(result: ExecResult): string {
  const stderr = result.stderr.trim();
  if (/Host key verification failed/i.test(stderr))
    return '主机指纹未确认：请先在终端执行一次 ssh 连接，或把主机写入 known_hosts 后重试';
  if (/Permission denied|no such identity|Authentication failed/i.test(stderr))
    return '认证失败：确认公钥已加到远端 authorized_keys，或填写正确的私钥文件';
  if (/Connection timed out|Connection refused|Could not resolve hostname/i.test(stderr))
    return `无法连接远端：${stderr.split('\n')[0]}`;
  return stderr || `远端命令退出码 ${result.code}`;
}

async function run(target: RemoteTarget, command: string, options: ExecOptions = {}) {
  const result = await exec(target, command, options);
  if (result.code !== 0) throw new Error(sshErrorMessage(result));
  return result;
}

export async function probeRemote(target: RemoteTarget) {
  const result = await exec(
    target,
    `printf '%s\\n%s\\n%s\\n%s' "$(uname -s)" "$(uname -m)" "$(hostname)" "$(command -v bash || true)"`,
    { timeoutMs: 20_000 },
  );
  if (result.code !== 0) throw new Error(sshErrorMessage(result));
  const [system = '', machine = '', hostname = '', bash = ''] = result.stdout
    .toString()
    .split('\n');
  return { system, machine, hostname, bash, home: await remoteHome(target) };
}

async function remoteHome(target: RemoteTarget): Promise<string> {
  const result = await run(target, 'printf %s "$HOME"', { timeoutMs: 20_000 });
  const home = result.stdout.toString().trim();
  if (!home.startsWith('/')) throw new Error('未能解析远端主目录');
  return home;
}
