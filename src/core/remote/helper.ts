import { spawn, type ChildProcess } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { request as httpRequest, type IncomingMessage } from 'node:http';
import { createConnection, createServer } from 'node:net';
import { join } from 'node:path';
import type { RemoteChannelState, RemoteSetupProgress, RemoteTask } from '../protocol/remote';
import { hostPorts } from '../ports';
import {
  exec,
  locateSsh,
  shellQuote,
  sshBaseArguments,
  sshErrorMessage,
  targetKey,
  type RemoteDirEntry,
  type RemoteTarget,
} from './transport';

export const HELPER_VERSION = '0.3.6';
const PROTOCOL_VERSION = 2;
const HEARTBEAT_MS = 30_000;
const IDLE_TIMEOUT = '1h';
const BOOTSTRAP_TIMEOUT_MS = 30_000;
const UPLOAD_TIMEOUT_MS = 300_000;
const REQUEST_TIMEOUT_MS = 120_000;
const TUNNEL_READY_MS = 5_000;
const STARTUP_WAIT_MS = 20_000;
const PROBE_TIMEOUT_MS = 3_000;
const HEARTBEAT_FAILURES_BEFORE_LOST = 3;
const RECONNECT_MIN_MS = 1_000;
const RECONNECT_MAX_MS = 8_000;
const RECONNECT_WINDOW_MS = 60_000;
const RETRY_AFTER_MS = 30_000;
const STREAM_IDLE_MS = 90_000;

export type WatchEvent =
  { type: 'change'; id: string; paths: string[] } | { type: 'reset'; id: string; reason: string };

function helperArch(machine: string): 'amd64' | 'arm64' | null {
  if (machine === 'x86_64' || machine === 'amd64') return 'amd64';
  if (machine === 'aarch64' || machine === 'arm64') return 'arm64';
  return null;
}

export function helperArtifact(arch: string): string | null {
  const path = join(hostPorts().paths.bundled('delion-helper'), `delion-helper-linux-${arch}`);
  return existsSync(path) ? path : null;
}

function rgArtifact(arch: string): string | null {
  const path = join(hostPorts().paths.bundled('remote-rg'), `rg-linux-${arch}`);
  return existsSync(path) ? path : null;
}

function helperRemoteDir(digest: string): string {
  return `$HOME/.delion-bot/helper/${HELPER_VERSION}-${digest.slice(0, 8)}`;
}

interface Artifact {
  label: string;
  dir: string;
  file: string;
  local: string;
  digest: string;
}

export function classifyEnvironment(output: string): string | null {
  const values = new Map<string, string>();
  for (const pair of output.split('|')) {
    const cut = pair.indexOf('=');
    if (cut > 0) values.set(pair.slice(0, cut).trim(), pair.slice(cut + 1).trim());
  }
  const options = (values.get('mount') ?? '').split(',').map((option) => option.trim());
  const execDenied = (values.get('direct') ?? '').startsWith('exit-');
  if (options.includes('noexec'))
    return 'helper 目录所在挂载点启用了 noexec，服务器不允许执行这里的文件';
  if (options.includes('ro')) return 'helper 目录所在挂载点是只读的（$HOME 可能被设为只读）';
  if (values.get('writable') === 'no') return 'helper 目录不可写（权限不足或只读 $HOME）';
  if (execDenied && values.get('selinux') === 'Enforcing')
    return 'SELinux 处于 Enforcing，拦截了 helper 的执行';
  if (execDenied) return '直接执行 helper 被拒绝（通常是 noexec 或安全模块拦截）';
  return null;
}

async function diagnoseEnvironment(target: RemoteTarget, dir: string): Promise<string | null> {
  try {
    const script = [
      `dir=${dir}`,
      `printf 'mount='; findmnt -no OPTIONS -T "$dir" 2>/dev/null || true`,
      `printf '|writable='; [ -w "$dir" ] && echo yes || echo no`,
      `printf '|selinux='; getenforce 2>/dev/null || echo absent`,
      `printf '|direct='; "$dir/delion-helper" --version >/dev/null 2>&1 && echo ok || echo "exit-$?"`,
    ].join('\n');
    const result = await exec(target, script, { timeoutMs: BOOTSTRAP_TIMEOUT_MS });
    if (result.code !== 0) return null;
    return classifyEnvironment(result.stdout.toString());
  } catch {
    return null;
  }
}

function tunnelArguments(target: RemoteTarget, localPort: number, remotePort: number): string[] {
  return [
    ...sshBaseArguments(target),
    '-o',
    'ExitOnForwardFailure=yes',
    '-N',
    '-L',
    `127.0.0.1:${localPort}:127.0.0.1:${remotePort}`,
    target.host,
  ];
}

interface Tunnel {
  localPort: number;
  process: ChildProcess;
}

async function openTunnel(target: RemoteTarget, remotePort: number): Promise<Tunnel> {
  const localPort = await freePort();
  const tunnel = spawn(locateSsh(), tunnelArguments(target, localPort, remotePort), {
    windowsHide: true,
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  let stderr = '';
  tunnel.stderr?.on('data', (chunk: Buffer) => {
    stderr += chunk.toString();
  });
  try {
    await waitForPort(localPort, TUNNEL_READY_MS, tunnel);
    return { localPort, process: tunnel };
  } catch (error) {
    tunnel.kill();
    const detail = stderr.trim();
    throw detail ? new Error(`${String(error)}｜${detail}`) : error;
  }
}

export async function openPortTunnel(
  target: RemoteTarget,
  remotePort: number,
): Promise<PortTunnel> {
  const tunnel = await openTunnel(target, remotePort);
  let closed = false;
  return {
    localPort: tunnel.localPort,
    close() {
      if (closed) return;
      closed = true;
      tunnel.process.kill();
    },
  };
}

export interface HelperExecOptions {
  id?: string;
  cwd: string;
  signal?: AbortSignal;
  timeoutMs?: number;
  env?: Record<string, string>;
  onData?: (chunk: Buffer) => void;
}

export interface HelperExecResult {
  code: number;
  state: 'exited' | 'cancelled' | 'timeout';
  lost: number;
}

export interface HelperStat {
  path: string;
  exists: boolean;
  directory: boolean;
  readable: boolean;
  size: number;
  modifiedAt: number;
}

export interface HelperLocation {
  path: string;
  kind: 'directory' | 'file' | 'missing';
  entries: RemoteDirEntry[];
}

export interface HelperGlobResult {
  files: string[];
  truncated: boolean;
}

export interface HelperSearchRequest {
  path: string;
  pattern: string;
  glob?: string;
  ignoreCase?: boolean;
  literal?: boolean;
  context?: number;
  limit?: number;
}

export interface HelperSearchMatch {
  path: string;
  line: number;
  text: string;
  context?: { line: number; text: string }[];
}

export interface HelperSearchResult {
  matches: HelperSearchMatch[];
  truncated: boolean;
}

export interface HelperPort {
  port: number;
  pid?: number;
  process?: string;
}

export interface PortTunnel {
  localPort: number;
  close(): void;
}

export interface ScopedFileOperation {
  action: 'read' | 'ls' | 'write' | 'edit' | 'find' | 'grep' | 'stat';
  path: string;
  content?: string;
  data?: string;
  oldText?: string;
  pattern?: string;
  limit?: number;
  writable?: boolean;
}

export interface ScopedFileResponse {
  data?: string;
  entries?: string[];
  kind?: 'file' | 'directory';
  matches?: { path: string; line: number; text: string }[];
  limited?: boolean;
  error?: string;
}

export interface ScopedCommandResult {
  exitCode: number | null;
  output: string;
  error?: string;
}

export interface HelperSession {
  target: RemoteTarget;
  scopedFile(
    directory: string,
    operation: ScopedFileOperation,
    signal: AbortSignal,
  ): Promise<ScopedFileResponse>;
  scopedCommand(
    command: string,
    inputs: readonly Buffer[],
    signal: AbortSignal,
  ): Promise<ScopedCommandResult>;
  readFile(path: string, signal?: AbortSignal): Promise<Buffer>;
  readFileRange(
    path: string,
    offset: number,
    length: number,
    signal?: AbortSignal,
  ): Promise<Buffer>;
  writeFile(path: string, content: Buffer | string): Promise<void>;
  list(path: string, signal?: AbortSignal): Promise<RemoteDirEntry[]>;
  locate(path: string, signal?: AbortSignal): Promise<HelperLocation>;
  stat(paths: string[], signal?: AbortSignal): Promise<HelperStat[]>;
  glob(
    path: string,
    pattern: string,
    limit: number,
    signal?: AbortSignal,
  ): Promise<HelperGlobResult>;
  search(request: HelperSearchRequest, signal?: AbortSignal): Promise<HelperSearchResult>;
  setWatch(id: string, paths: string[]): Promise<{ watching: number; skipped: string[] }>;
  clearWatch(id: string): Promise<void>;
  listPorts(): Promise<HelperPort[]>;
  listTasks(): Promise<RemoteTask[]>;
  cancelTask(id: string): Promise<void>;
  watchEvents(onEvent: (event: WatchEvent) => void, signal?: AbortSignal): Promise<void>;
  exec(command: string, options: HelperExecOptions): Promise<HelperExecResult>;
}

function sha256Of(body: Buffer): string {
  return createHash('sha256').update(body).digest('hex');
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close(() => (port ? resolve(port) : reject(new Error('未能分配到本地端口'))));
    });
  });
}

function waitForPort(port: number, timeoutMs: number, owner?: ChildProcess): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    let exited = false;
    owner?.once('exit', () => {
      exited = true;
    });
    const attempt = () => {
      const socket = createConnection({ host: '127.0.0.1', port });
      socket.once('connect', () => {
        socket.destroy();
        resolve();
      });
      socket.once('error', () => {
        socket.destroy();
        if (exited) reject(new Error('隧道进程已退出'));
        else if (Date.now() > deadline) reject(new Error('隧道未就绪'));
        else setTimeout(attempt, 100);
      });
    };
    attempt();
  });
}
interface HttpResponse {
  status: number;
  body: Buffer;
}

class HelperTransportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'HelperTransportError';
  }
}

class HelperHttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'HelperHttpError';
  }
}

export class HelperUnavailableError extends Error {
  constructor(
    readonly destination: string,
    readonly reason: string,
  ) {
    super(`远端 ${destination} 不可用：${reason}`);
    this.name = 'HelperUnavailableError';
  }
}

const aborted = () => new Error('aborted');

interface Endpoint {
  port: number;
  token: string;
}

function sendRequest(
  endpoint: Endpoint,
  method: string,
  path: string,
  options: { body?: Buffer | string; timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<HttpResponse> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let responded = false;
    const settle = (error?: Error, value?: HttpResponse) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', onAbort);
      if (options.signal?.aborted) reject(aborted());
      else if (error) reject(error);
      else resolve(value!);
    };
    if (options.signal?.aborted) {
      reject(aborted());
      return;
    }
    const request = httpRequest(
      {
        host: '127.0.0.1',
        port: endpoint.port,
        method,
        path,
        headers: {
          Authorization: `Bearer ${endpoint.token}`,
          ...(options.body === undefined
            ? {}
            : { 'Content-Length': Buffer.byteLength(options.body) }),
        },
      },
      (response) => {
        responded = true;
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer) => chunks.push(chunk));
        response.on('end', () =>
          settle(undefined, { status: response.statusCode ?? 0, body: Buffer.concat(chunks) }),
        );
        response.on('error', () => settle(new HelperTransportError('helper 连接中断')));
        response.on('close', () => settle(new HelperTransportError('helper 连接中断')));
      },
    );
    const timer = setTimeout(
      () => request.destroy(new HelperTransportError('请求超时')),
      options.timeoutMs ?? REQUEST_TIMEOUT_MS,
    );
    const onAbort = () => request.destroy(aborted());
    options.signal?.addEventListener('abort', onAbort, { once: true });
    request.on('error', (error: Error) =>
      settle(
        error instanceof HelperTransportError ? error : new HelperTransportError(error.message),
      ),
    );
    request.on('close', () => {
      if (!responded) settle(new HelperTransportError('helper 连接中断'));
    });
    if (options.body !== undefined) request.write(options.body);
    request.end();
  });
}

function assertOk(response: HttpResponse, what: string): void {
  if (response.status >= 200 && response.status < 300) return;
  let detail = response.body.toString().trim();
  try {
    const parsed = JSON.parse(detail) as { error?: { message?: string } };
    if (parsed.error?.message) detail = parsed.error.message;
  } catch {}
  throw new HelperHttpError(`${what}失败：${detail.slice(0, 300)}`, response.status);
}

function openSse(
  endpoint: Endpoint,
  path: string,
  onFrame: (value: unknown) => void,
  options: { signal?: AbortSignal; idleMs: number },
): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let watchdog: NodeJS.Timeout | undefined;
    const settle = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(watchdog);
      options.signal?.removeEventListener('abort', onAbort);
      if (options.signal?.aborted) reject(aborted());
      else if (error) reject(error);
      else resolve();
    };
    if (options.signal?.aborted) {
      reject(aborted());
      return;
    }
    const request = httpRequest(
      {
        host: '127.0.0.1',
        port: endpoint.port,
        method: 'GET',
        path,
        headers: { Authorization: `Bearer ${endpoint.token}` },
      },
      (response: IncomingMessage) => {
        if ((response.statusCode ?? 0) !== 200) {
          const chunks: Buffer[] = [];
          response.on('data', (chunk: Buffer) => chunks.push(chunk));
          response.on('end', () => {
            try {
              assertOk({ status: response.statusCode ?? 0, body: Buffer.concat(chunks) }, path);
            } catch (error) {
              settle(error as Error);
            }
          });
          return;
        }
        const arm = () => {
          clearTimeout(watchdog);
          watchdog = setTimeout(
            () => request.destroy(new HelperTransportError('流静默超时')),
            options.idleMs,
          );
        };
        arm();
        let buffer = '';
        response.on('data', (chunk: Buffer) => {
          arm();
          buffer += chunk.toString('utf8');
          const frames = buffer.split('\n\n');
          buffer = frames.pop() ?? '';
          for (const frame of frames) {
            const line = frame.split('\n').find((item) => item.startsWith('data: '));
            if (!line) continue;
            let value: unknown;
            try {
              value = JSON.parse(line.slice(6));
            } catch {
              continue;
            }
            onFrame(value);
          }
        });
        response.on('end', () => settle());
        response.on('error', () => settle(new HelperTransportError('流中断')));
        response.on('close', () => settle(new HelperTransportError('流中断')));
      },
    );
    const onAbort = () => request.destroy(aborted());
    options.signal?.addEventListener('abort', onAbort, { once: true });
    request.on('error', (error: Error) =>
      settle(
        error instanceof HelperTransportError ? error : new HelperTransportError(error.message),
      ),
    );
    request.end();
  });
}

async function ensureArtifacts(
  target: RemoteTarget,
  artifacts: Artifact[],
  onProgress?: (progress: RemoteSetupProgress) => void,
): Promise<void> {
  const probe = await exec(
    target,
    artifacts
      .flatMap(({ dir, file, digest }, index) => [
        `dir=${dir}`,
        'mkdir -p "$dir"',
        'chmod 700 "$dir"',
        `[ -x "$dir/${file}" ] && [ "$(sha256sum "$dir/${file}" 2>/dev/null | cut -d" " -f1)" = "${digest}" ] || printf '%s ' ${index}`,
      ])
      .join('\n'),
    { timeoutMs: BOOTSTRAP_TIMEOUT_MS },
  );
  if (probe.code !== 0) throw new Error(sshErrorMessage(probe));
  const missing = probe.stdout
    .toString()
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((index) => artifacts[Number(index)]!);
  if (!missing.length) {
    onProgress?.({ step: 'verify', ok: true, detail: '远端已有这一版产物，跳过上传' });
    return;
  }
  for (const artifact of missing) await uploadArtifact(target, artifact, onProgress);
  onProgress?.({ step: 'verify', ok: true, detail: 'sha256 校验通过' });
}

async function uploadArtifact(
  target: RemoteTarget,
  { label, dir, file, local, digest }: Artifact,
  onProgress?: (progress: RemoteSetupProgress) => void,
): Promise<void> {
  const body = readFileSync(local);
  onProgress?.({
    step: 'upload',
    detail: `开始上传 ${label}`,
    bytes: { sent: 0, total: body.length },
  });
  let reported = 0;
  const upload = await exec(
    target,
    [
      'set -e',
      `dir=${dir}`,
      'tmp="$dir/.upload-$$"',
      'base64 -d > "$tmp"',
      'chmod 700 "$tmp"',
      `mv -f "$tmp" "$dir/${file}"`,
      `sha256sum "$dir/${file}" | cut -d" " -f1`,
    ].join('\n'),
    {
      stdin: `${body.toString('base64')}\n`,
      timeoutMs: UPLOAD_TIMEOUT_MS,
      onStdinProgress: (sent, total) => {
        const bytes = Math.round((sent / total) * body.length);
        if (bytes - reported < body.length / 50 && sent < total) return;
        reported = bytes;
        onProgress?.({ step: 'upload', bytes: { sent: bytes, total: body.length } });
      },
    },
  );
  const uploaded = upload.stdout.toString().trim();
  if (upload.code !== 0 || uploaded !== digest) {
    onProgress?.({ step: 'upload', ok: false });
    throw new Error(
      `${label} 上传校验失败：期望 ${digest.slice(0, 12)}，远端 ${uploaded.slice(0, 12) || upload.stderr.trim()}`,
    );
  }
  onProgress?.({
    step: 'upload',
    ok: true,
    detail: `${label} 上传完成`,
    bytes: { sent: body.length, total: body.length },
  });
}

async function findOrStart(
  target: RemoteTarget,
  dir: string,
  rg: string | null,
): Promise<Endpoint & { reused: boolean }> {
  const token = randomBytes(24).toString('hex');
  const script = [
    'set -e',
    `dir=${dir}`,
    'node=$(hostname)',
    'case "$node" in ""|.|..|*[!a-zA-Z0-9._-]*) printf "%s\\n" "无法识别远端主机名" >&2; exit 1;; esac',
    'runtime="$dir/runtime/$node"',
    'umask 077',
    'mkdir -p "$runtime"',
    'alive() { [ -s "$runtime/run.json" ] && pid=$(sed -n \'s/.*"pid":\\([0-9]*\\).*/\\1/p\' "$runtime/run.json") && [ -n "$pid" ] && [ "$(readlink "/proc/$pid/exe" 2>/dev/null)" = "$dir/delion-helper" ]; }',
    'if alive; then printf REUSE; cat "$runtime/run.json"; printf "\\n"; cat "$runtime/token"; exit 0; fi',
    `printf '%s' ${shellQuote(token)} > "$runtime/token.new"`,
    'mv -f "$runtime/token.new" "$runtime/token"',
    'rm -f "$runtime/run.json"',
    `setsid nohup "$dir/delion-helper" --port 0 --token-file "$runtime/token" --run-file "$runtime/run.json" --lock-file "$runtime/lock" --idle-timeout ${IDLE_TIMEOUT}${rg ? ` --rg "${rg}"` : ''} >> "$runtime/helper.log" 2>&1 < /dev/null &`,
    'for i in $(seq 1 40); do alive && break; sleep 0.25; done',
    'if alive; then printf START; cat "$runtime/run.json"; printf "\\n"; cat "$runtime/token"; else printf START-FAILED; tail -n 3 "$runtime/helper.log" 2>/dev/null; exit 4; fi',
  ].join('\n');
  const result = await exec(target, script, { timeoutMs: STARTUP_WAIT_MS });
  const text = result.stdout.toString();
  const reused = text.startsWith('REUSE');
  if (result.code !== 0 || !(reused || text.startsWith('START{')))
    throw new Error(`helper 启动失败：${text.trim() || sshErrorMessage(result)}`);
  const [state = '', remoteToken = ''] = text.slice('START'.length).split('\n');
  const port = (JSON.parse(state) as { port?: number }).port;
  if (!port || remoteToken.trim().length < 16) throw new Error('helper 未报告端口或 token');
  return { port, token: remoteToken.trim(), reused };
}

async function bootstrap(
  target: RemoteTarget,
  onProgress?: (progress: RemoteSetupProgress) => void,
): Promise<{ remote: Endpoint; dir: string }> {
  const step = async <T>(name: RemoteSetupProgress['step'], work: () => Promise<T>): Promise<T> => {
    try {
      return await work();
    } catch (error) {
      onProgress?.({
        step: name,
        ok: false,
        detail: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  };
  const { helper, rg } = await step('probe', async () => {
    const probe = await exec(target, 'uname -s; uname -m', { timeoutMs: BOOTSTRAP_TIMEOUT_MS });
    if (probe.code !== 0) throw new Error(sshErrorMessage(probe));
    const [system = '', machine = ''] = probe.stdout.toString().trim().split('\n');
    if (system.trim() !== 'Linux') throw new Error(`远程项目只支持 Linux，远端是 ${system.trim()}`);
    const arch = helperArch(machine.trim());
    if (!arch) throw new Error(`没有 ${machine.trim()} 架构的 helper`);
    const helper = helperArtifact(arch);
    if (!helper) throw new Error(`缺少 helper 产物：linux/${arch}`);
    return { helper, rg: rgArtifact(arch) };
  });
  const digest = sha256Of(readFileSync(helper));
  const dir = helperRemoteDir(digest);
  const artifacts: Artifact[] = [
    { label: 'helper', dir, file: 'delion-helper', local: helper, digest },
  ];
  let remoteRg: string | null = null;
  if (rg) {
    const rgDigest = sha256Of(readFileSync(rg));
    const rgDir = `$HOME/.delion-bot/rg/${rgDigest.slice(0, 8)}`;
    artifacts.push({ label: 'rg', dir: rgDir, file: 'rg', local: rg, digest: rgDigest });
    remoteRg = `${rgDir}/rg`;
  }
  await step('verify', () => ensureArtifacts(target, artifacts, onProgress));
  const remote = await step('start', async () => {
    try {
      return await findOrStart(target, dir, remoteRg);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const diagnosis = await diagnoseEnvironment(target, dir);
      throw new Error(diagnosis ? `${message}（诊断：${diagnosis}）` : message);
    }
  });
  onProgress?.({
    step: 'start',
    ok: true,
    detail: `${remote.reused ? '复用已在运行的实例' : '已启动新实例'}，远端 127.0.0.1:${remote.port}`,
  });
  return { remote, dir };
}
interface Link {
  endpoint: Endpoint;
  process: ChildProcess;
  home: string;
}

export type Connector = (
  target: RemoteTarget,
  onProgress?: (progress: RemoteSetupProgress) => void,
) => Promise<Link>;

const connectRemote: Connector = async (target, onProgress) => {
  const { remote } = await bootstrap(target, onProgress);
  let tunnel: Tunnel;
  try {
    tunnel = await openTunnel(target, remote.port);
  } catch (error) {
    onProgress?.({ step: 'tunnel', ok: false, detail: String(error) });
    throw error;
  }
  onProgress?.({
    step: 'tunnel',
    ok: true,
    detail: `本地 127.0.0.1:${tunnel.localPort} → 远端 127.0.0.1:${remote.port}`,
  });
  const endpoint = { port: tunnel.localPort, token: remote.token };
  let home = '';
  try {
    const response = await sendRequest(endpoint, 'GET', '/v1/hello', { timeoutMs: 10_000 });
    assertOk(response, '握手');
    const hello = JSON.parse(response.body.toString()) as {
      protocol: number;
      helperVersion: string;
      home?: string;
    };
    home = hello.home ?? '';
    if (hello.protocol !== PROTOCOL_VERSION || hello.helperVersion !== HELPER_VERSION)
      throw new Error(`helper 版本不匹配：协议 ${hello.protocol}、版本 ${hello.helperVersion}`);
    onProgress?.({
      step: 'handshake',
      ok: true,
      detail: `协议 ${hello.protocol} · helper ${hello.helperVersion}`,
    });
  } catch (error) {
    tunnel.process.kill();
    onProgress?.({ step: 'handshake', ok: false, detail: String(error) });
    throw error;
  }
  return { endpoint, process: tunnel.process, home };
};

export type ChannelState = 'connecting' | 'ready' | 'reconnecting' | 'unavailable';

class Channel {
  state: ChannelState = 'connecting';
  reason = '';
  since = Date.now();
  home = '';
  private endpoint: Endpoint | null = null;
  private tunnel: ChildProcess | null = null;
  private heartbeat: NodeJS.Timeout | undefined;
  private waiters: { resolve: (endpoint: Endpoint) => void; reject: (error: Error) => void }[] = [];
  private connecting: Promise<void> | null = null;
  private lastAttempt = 0;
  private closed = false;
  readonly session: HelperSession;

  constructor(
    readonly target: RemoteTarget,
    private readonly onState: () => void,
    private readonly connector: Connector = connectRemote,
  ) {
    this.session = createSession(this);
  }

  endpointFor(signal?: AbortSignal): Promise<Endpoint> {
    if (this.closed)
      return Promise.reject(new HelperUnavailableError(this.target.host, '通道已关闭'));
    if (this.state === 'ready' && this.endpoint) return Promise.resolve(this.endpoint);
    if (this.state === 'unavailable') {
      if (Date.now() - this.lastAttempt < RETRY_AFTER_MS)
        return Promise.reject(new HelperUnavailableError(this.target.host, this.reason));
      this.connect('connecting');
    }
    return new Promise((resolve, reject) => {
      const waiter = {
        resolve: (endpoint: Endpoint) => {
          signal?.removeEventListener('abort', onAbort);
          resolve(endpoint);
        },
        reject: (error: Error) => {
          signal?.removeEventListener('abort', onAbort);
          reject(error);
        },
      };
      const onAbort = () => {
        this.waiters = this.waiters.filter((item) => item !== waiter);
        reject(aborted());
      };
      signal?.addEventListener('abort', onAbort, { once: true });
      this.waiters.push(waiter);
    });
  }

  async retry(): Promise<void> {
    if (this.state === 'unavailable') await this.connect('connecting');
  }

  snapshotWithHome() {
    return { ...this.snapshot(), home: this.home };
  }

  snapshot(): RemoteChannelState {
    return {
      destination: this.target.host,
      state: this.state,
      reason: this.reason,
      since: this.since,
    };
  }

  connect(state: 'connecting' | 'reconnecting', onProgress?: (p: RemoteSetupProgress) => void) {
    if (this.connecting) return this.connecting;
    this.setState(state);
    this.connecting = this.run(state, onProgress).finally(() => {
      this.connecting = null;
    });
    return this.connecting;
  }

  private async run(
    state: 'connecting' | 'reconnecting',
    onProgress?: (p: RemoteSetupProgress) => void,
  ): Promise<void> {
    const deadline = Date.now() + RECONNECT_WINDOW_MS;
    let backoff = RECONNECT_MIN_MS;
    for (;;) {
      this.lastAttempt = Date.now();
      try {
        await this.establish(onProgress);
        return;
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        if (this.closed || state === 'connecting' || Date.now() + backoff > deadline) {
          if (!this.closed) this.fail(reason.slice(0, 300));
          return;
        }
        console.warn(`[remotes] ${this.target.host} 重连失败，${backoff}ms 后重试`, reason);
        await new Promise((resolve) => setTimeout(resolve, backoff));
        backoff = Math.min(backoff * 2, RECONNECT_MAX_MS);
      }
    }
  }

  private async establish(onProgress?: (p: RemoteSetupProgress) => void): Promise<void> {
    const link = await this.connector(this.target, onProgress);
    if (this.closed) {
      link.process.kill();
      return;
    }
    this.tunnel = link.process;
    this.endpoint = link.endpoint;
    this.home = link.home;
    link.process.once('exit', () => {
      if (this.tunnel === link.process) this.lost('隧道进程退出');
    });
    this.startHeartbeat(link.endpoint);
    this.setState('ready');
    for (const waiter of this.waiters.splice(0)) waiter.resolve(link.endpoint);
  }

  private startHeartbeat(endpoint: Endpoint) {
    clearInterval(this.heartbeat);
    let failures = 0;
    this.heartbeat = setInterval(() => {
      void sendRequest(endpoint, 'POST', '/v1/heartbeat', { timeoutMs: 10_000 })
        .then(() => {
          failures = 0;
        })
        .catch(() => {
          if (++failures >= HEARTBEAT_FAILURES_BEFORE_LOST && this.endpoint === endpoint)
            this.lost('心跳连续失败');
        });
    }, HEARTBEAT_MS);
  }

  lost(why: string) {
    if (this.closed || this.state !== 'ready') return;
    console.warn(`[remotes] ${this.target.host} 通道中断（${why}），开始重连`);
    this.teardown();
    void this.connect('reconnecting');
  }

  async suspect(endpoint: Endpoint) {
    if (this.endpoint !== endpoint) return;
    try {
      const response = await sendRequest(endpoint, 'GET', '/v1/hello', {
        timeoutMs: PROBE_TIMEOUT_MS,
      });
      if (response.status >= 200 && response.status < 300) return;
    } catch {}
    if (this.endpoint === endpoint) this.lost('探活失败');
  }

  private fail(reason: string) {
    this.reason = reason;
    this.setState('unavailable');
    const error = new HelperUnavailableError(this.target.host, reason);
    for (const waiter of this.waiters.splice(0)) waiter.reject(error);
  }

  private teardown() {
    clearInterval(this.heartbeat);
    this.heartbeat = undefined;
    const tunnel = this.tunnel;
    this.tunnel = null;
    this.endpoint = null;
    tunnel?.kill();
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    this.teardown();
    for (const waiter of this.waiters.splice(0))
      waiter.reject(new HelperUnavailableError(this.target.host, '通道已关闭'));
  }

  private setState(state: ChannelState) {
    if (this.state !== state) {
      this.state = state;
      this.since = Date.now();
    }
    if (state !== 'unavailable') this.reason = '';
    this.onState();
  }
}

async function retrying<T>(
  channel: Channel,
  signal: AbortSignal | undefined,
  work: (endpoint: Endpoint) => Promise<T>,
): Promise<T> {
  for (;;) {
    const endpoint = await channel.endpointFor(signal);
    try {
      return await work(endpoint);
    } catch (error) {
      if (!(error instanceof HelperTransportError) || signal?.aborted) throw error;
      await channel.suspect(endpoint);
    }
  }
}

function createSession(channel: Channel): HelperSession {
  const request = (
    method: string,
    path: string,
    what: string,
    options: { body?: Buffer | string; signal?: AbortSignal } = {},
  ) =>
    retrying(channel, options.signal, async (endpoint) => {
      const response = await sendRequest(endpoint, method, path, options);
      assertOk(response, what);
      return response.body;
    });
  const json = async <T>(
    method: string,
    path: string,
    what: string,
    body?: unknown,
    signal?: AbortSignal,
  ): Promise<T> =>
    JSON.parse(
      (
        await request(method, path, what, {
          body: body === undefined ? undefined : JSON.stringify(body),
          signal,
        })
      ).toString(),
    ) as T;

  return {
    target: channel.target,
    async scopedFile(directory, operation, signal) {
      const endpoint = await channel.endpointFor(signal);
      const response = await sendRequest(endpoint, 'POST', '/v1/fs/scoped', {
        body: JSON.stringify({ directory, ...operation }),
        timeoutMs: 10_000,
        signal,
      });
      assertOk(response, '访问远程授权目录');
      return JSON.parse(response.body.toString()) as ScopedFileResponse;
    },
    async scopedCommand(command, inputs, signal) {
      const endpoint = await channel.endpointFor(signal);
      const response = await sendRequest(endpoint, 'POST', '/v1/commands/scoped', {
        body: JSON.stringify({ command, inputs: inputs.map((bytes) => bytes.toString('base64')) }),
        timeoutMs: 12_000,
        signal,
      });
      assertOk(response, '运行远程受限命令');
      return JSON.parse(response.body.toString()) as ScopedCommandResult;
    },
    readFile: (path, signal) =>
      request('GET', `/v1/fs/read?path=${encodeURIComponent(path)}`, `读取 ${path} `, { signal }),
    readFileRange: (path, offset, length, signal) =>
      request(
        'GET',
        `/v1/fs/read?path=${encodeURIComponent(path)}&offset=${offset}&length=${length}`,
        `读取 ${path} `,
        { signal },
      ),
    async writeFile(path, content) {
      const body = Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf8');
      await request(
        'PUT',
        `/v1/fs/write?parents=1&path=${encodeURIComponent(path)}`,
        `写入 ${path} `,
        {
          body,
        },
      );
    },
    list: async (path, signal) =>
      (
        await json<{ entries?: RemoteDirEntry[] }>(
          'POST',
          '/v1/fs/list',
          `列出 ${path} `,
          { path },
          signal,
        )
      ).entries ?? [],
    locate: async (path, signal) => {
      const body = await json<{ kind: HelperLocation['kind']; entries?: RemoteDirEntry[] }>(
        'POST',
        '/v1/fs/list',
        `列出 ${path} `,
        { path, locate: true },
        signal,
      );
      return { path, kind: body.kind, entries: body.entries ?? [] };
    },
    stat: async (paths, signal) =>
      (await json<{ items?: HelperStat[] }>('POST', '/v1/fs/stat', '查询路径', { paths }, signal))
        .items ?? [],
    glob: (path, pattern, limit, signal) =>
      json<HelperGlobResult>('POST', '/v1/fs/glob', '查找文件', { path, pattern, limit }, signal),
    search: (body, signal) =>
      json<HelperSearchResult>('POST', '/v1/fs/search', '搜索', body, signal),
    async setWatch(id, paths) {
      const body = await json<{ watching?: number; skipped?: string[] }>(
        'POST',
        '/v1/watch',
        `监视 ${paths.length} 个目录`,
        { id, paths },
      );
      return { watching: body.watching ?? 0, skipped: body.skipped ?? [] };
    },
    async clearWatch(id) {
      await request('DELETE', `/v1/watch?id=${encodeURIComponent(id)}`, `取消监视 ${id} `);
    },
    listPorts: async () =>
      (await json<{ ports?: HelperPort[] }>('GET', '/v1/ports', '列出远端端口')).ports ?? [],
    listTasks: async () =>
      (await json<{ tasks?: RemoteTask[] }>('GET', '/v1/tasks', '列出远端任务')).tasks ?? [],
    async cancelTask(id) {
      await request('POST', `/v1/tasks/${encodeURIComponent(id)}/cancel`, `取消任务 ${id} `);
    },
    async watchEvents(onEvent, signal) {
      const endpoint = await channel.endpointFor(signal);
      try {
        await openSse(endpoint, '/v1/watch', (value) => onEvent(value as WatchEvent), {
          signal,
          idleMs: STREAM_IDLE_MS,
        });
      } catch (error) {
        if (error instanceof HelperTransportError) void channel.suspect(endpoint);
        throw error;
      }
    },
    exec: (command, options) => runTask(channel, command, options),
  };
}

interface TaskFrame {
  type: 'output' | 'gap' | 'exit';
  offset?: number;
  data?: string;
  bytes?: number;
  state?: HelperExecResult['state'];
  code?: number;
}

async function runTask(
  channel: Channel,
  command: string,
  options: HelperExecOptions,
): Promise<HelperExecResult> {
  const id = options.id ?? randomBytes(12).toString('hex');
  const body = JSON.stringify({
    id,
    command,
    cwd: options.cwd,
    timeoutMs: options.timeoutMs ?? 0,
    env: Object.entries(options.env ?? {}).map(([key, value]) => `${key}=${value}`),
  });
  const signal = options.signal;
  const cancel = () => {
    void channel
      .endpointFor()
      .then((endpoint) =>
        sendRequest(endpoint, 'POST', `/v1/tasks/${id}/cancel`, { timeoutMs: 10_000 }),
      )
      .catch(() => {});
  };
  signal?.addEventListener('abort', cancel, { once: true });
  try {
    await retrying(channel, signal, async (endpoint) => {
      const response = await sendRequest(endpoint, 'POST', '/v1/tasks', { body, signal });
      assertOk(response, '执行命令');
    });
    let offset = 0;
    let lost = 0;
    let exit: TaskFrame | null = null;
    while (!exit) {
      const endpoint = await channel.endpointFor(signal);
      try {
        await openSse(
          endpoint,
          `/v1/tasks/${id}/stream?offset=${offset}`,
          (value) => {
            const frame = value as TaskFrame;
            if (frame.type === 'gap') {
              lost += frame.bytes ?? 0;
              offset += frame.bytes ?? 0;
            } else if (frame.type === 'output' && frame.data) {
              const chunk = Buffer.from(frame.data, 'base64');
              offset = (frame.offset ?? offset) + chunk.length;
              options.onData?.(chunk);
            } else if (frame.type === 'exit') exit = frame;
          },
          { signal, idleMs: STREAM_IDLE_MS },
        );
        if (!exit) throw new HelperTransportError('任务流提前结束');
      } catch (error) {
        if (!(error instanceof HelperTransportError) || signal?.aborted) throw error;
        await channel.suspect(endpoint);
      }
    }
    const final = exit as TaskFrame;
    return { code: final.code ?? 0, state: final.state ?? 'exited', lost };
  } finally {
    signal?.removeEventListener('abort', cancel);
  }
}

const channels = new Map<string, Channel>();

let connector: Connector = connectRemote;

export function setConnectorForTesting(next: Connector | null): void {
  connector = next ?? connectRemote;
}

const stateListeners = new Set<(states: RemoteChannelState[]) => void>();

export function helperStates(): RemoteChannelState[] {
  return [...channels.values()].map((channel) => channel.snapshot());
}

export function onHelperState(listener: (states: RemoteChannelState[]) => void): () => void {
  stateListeners.add(listener);
  return () => stateListeners.delete(listener);
}

function broadcast(): void {
  const snapshot = helperStates();
  for (const listener of stateListeners) listener(snapshot);
}

function channelFor(target: RemoteTarget): Channel {
  const key = targetKey(target);
  let channel = channels.get(key);
  if (!channel) {
    channel = new Channel(target, broadcast, connector);
    channels.set(key, channel);
    void channel.connect('connecting');
  }
  return channel;
}

export function helperSession(target: RemoteTarget): HelperSession {
  return channelFor(target).session;
}

export async function retryHelper(target: RemoteTarget): Promise<RemoteChannelState> {
  const channel = channelFor(target);
  await channel.retry();
  return channel.snapshot();
}

export async function readyHelper(target: RemoteTarget): Promise<HelperSession> {
  const channel = channelFor(target);
  await channel.endpointFor();
  return channel.session;
}

export async function prepareHelper(
  target: RemoteTarget,
  onProgress?: (progress: RemoteSetupProgress) => void,
): Promise<{ ok: boolean; failure: string | null; home: string | null }> {
  const key = targetKey(target);
  const result = (channel: Channel) => {
    const { state, reason, home } = channel.snapshotWithHome();
    return state === 'ready'
      ? { ok: true, failure: null, home: home || null }
      : { ok: false, failure: reason, home: null };
  };
  const existing = channels.get(key);
  if (existing?.state === 'ready') return result(existing);
  if (existing && existing.state !== 'unavailable') {
    await existing.endpointFor().catch(() => {});
    return result(existing);
  }
  existing?.close();
  const channel = new Channel(target, broadcast, connector);
  channels.set(key, channel);
  await channel.connect('connecting', onProgress);
  return result(channel);
}

export function closeHelper(target?: RemoteTarget): void {
  const keys = target ? [targetKey(target)] : [...channels.keys()];
  for (const key of keys) {
    channels.get(key)?.close();
    channels.delete(key);
  }
  broadcast();
}
