import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:net';
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { linuxSandboxAvailability, runSandboxed } from '../../../../src/core/agent/sandbox/linux';
import type { SandboxRoots } from '../../../../src/core/agent/sandbox/mode';
import { sandboxBash, sandboxTools } from '../../../../src/core/agent/sandbox/tools';
import { provideTestHostPorts } from '../../host-mock';

const root =
  process.platform === 'linux'
    ? mkdtempSync(join('/home/ubuntu', 'delion-bwrap-'))
    : join('/home/ubuntu', 'delion-bwrap-skipped');
const sessionId = '11111111-1111-4111-8111-111111111111';
const privacyHost = join(root, 'storage', 'chat-sessions', sessionId);
const deliveryHost = join(root, 'storage', 'chat-delivery', sessionId);
const userData = join(root, 'userdata');
const external = join(root, 'external', 'readme.txt');
const secret = join(userData, 'delion.db');
const other = join(
  root,
  'storage',
  'chat-sessions',
  '22222222-2222-4222-8222-222222222222',
  'note.txt',
);

const available = process.platform === 'linux' && linuxSandboxAvailability().ok;

function roots(): SandboxRoots {
  return {
    ownerId: sessionId,
    privacyHost,
    deliveryHost,
    conceal: [sessionId, privacyHost, userData, deliveryHost],
  };
}

beforeAll(() => {
  if (!available) return;
  mkdirSync(privacyHost, { recursive: true });
  mkdirSync(join(privacyHost, '.home'), { recursive: true });
  mkdirSync(join(privacyHost, '.cache'), { recursive: true });
  mkdirSync(deliveryHost, { recursive: true });
  mkdirSync(userData, { recursive: true });
  mkdirSync(join(external, '..'), { recursive: true });
  writeFileSync(join(privacyHost, 'scratch.txt'), 'scratch');
  writeFileSync(secret, 'secret-db');
  mkdirSync(join(other, '..'), { recursive: true });
  writeFileSync(other, 'other-session');
  writeFileSync(external, 'ext');
  provideTestHostPorts({
    paths: {
      userData: () => userData,
      storage: () => join(root, 'storage'),
      home: () => root,
      temp: () => join(root, 'tmp'),
      documents: () => root,
    },
  });
});

afterAll(() => {
  if (process.platform === 'linux') rmSync(root, { recursive: true, force: true });
});

describe.skipIf(!available)('Linux bubblewrap 隔离', () => {
  it('外部只读、两个根可写、内部不可读、会话 id 不出现在进程视图里', async () => {
    const server = createServer();
    const accepted = new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => resolve(false), 2000);
      server.once('connection', () => {
        clearTimeout(timer);
        resolve(true);
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as { port: number }).port;
    const script = [
      'echo PWD=$(pwd)',
      'echo REAL=$(realpath /privacy)',
      'echo READ_EXT=$(cat ' + JSON.stringify(external) + ')',
      'echo x >> ' + JSON.stringify(external) + ' && echo WRITE_EXT_OK || echo WRITE_EXT_FAIL',
      'rm ' + JSON.stringify(external) + ' && echo DEL_EXT_OK || echo DEL_EXT_FAIL',
      'echo hi > /privacy/new.txt && echo WRITE_PRIV_OK',
      'echo d > /delivery/new.txt && echo WRITE_DEL_OK',
      'cat ' + JSON.stringify(secret) + ' >/dev/null 2>&1 && echo READ_DB_OK || echo READ_DB_FAIL',
      'cat ' +
        JSON.stringify(other) +
        ' >/dev/null 2>&1 && echo READ_OTHER_OK || echo READ_OTHER_FAIL',
      'echo LIST=$(ls ' +
        JSON.stringify(join(root, 'storage', 'chat-sessions')) +
        ' 2>&1 | tr "\\n" " ")',
      'ln ' +
        JSON.stringify(external) +
        ' /privacy/hard 2>/tmp/ln.err && echo HARDLINK_OK || echo HARDLINK_FAIL',
      'ln -sf ' +
        JSON.stringify(external) +
        ' /privacy/sym && echo via >> /privacy/sym && echo SYMLINK_OK || echo SYMLINK_FAIL',
      'python3 -c "import socket;s=socket.create_connection((\\"127.0.0.1\\",' +
        port +
        '),2)" && echo NET_OK || echo NET_FAIL',
      'python3 -c "import socket;s=socket.socket();s.settimeout(2);s.connect((\\"1.1.1.1\\",443))" && echo INET_OK || echo INET_FAIL',
      'test -e /proc/self/mountinfo && echo PROC_OK || echo PROC_FAIL',
      'echo ENV=$(env | tr "\\n" " ")',
      'echo DISPLAY=${DISPLAY-<unset>}',
      'test -e /tmp/.X11-unix && echo X11_OK || echo X11_FAIL',
    ].join('\n');
    const result = await runSandboxed(roots(), '/usr/bin/bash', ['-c', script], {
      cwd: '/privacy',
    });
    server.close();
    const output = result.stdout.toString('utf8') + result.stderr;
    expect(output).toContain('PWD=/privacy');
    expect(output).toContain('REAL=/privacy');
    expect(output).toContain('READ_EXT=ext');
    expect(output).toContain('WRITE_EXT_FAIL');
    expect(output).toContain('DEL_EXT_FAIL');
    expect(output).toContain('WRITE_PRIV_OK');
    expect(output).toContain('WRITE_DEL_OK');
    expect(output).toContain('READ_DB_FAIL');
    expect(output).toContain('READ_OTHER_FAIL');
    expect(output).toContain('HARDLINK_FAIL');
    expect(output).toContain('SYMLINK_FAIL');
    expect(output).toContain('NET_FAIL');
    expect(output).toContain('INET_FAIL');
    expect(output).toContain('PROC_FAIL');
    expect(output).toContain('X11_FAIL');
    expect(output).not.toContain(sessionId);
    expect(readFileSync(external, 'utf8')).toBe('ext');
    expect(readFileSync(join(privacyHost, 'new.txt'), 'utf8')).toBe('hi\n');
    expect(readFileSync(join(deliveryHost, 'new.txt'), 'utf8')).toBe('d\n');
    expect(await accepted).toBe(false);
  });

  it('前台和后台 bash 都不能改外部文件', async () => {
    const { backgroundTools } = await import('../../../../src/core/agent/tasks');
    const bash = (await sandboxTools(roots())).find((tool) => tool.name === 'bash')!;
    const foreground = await bash.execute(
      '1',
      { command: `echo no >> ${JSON.stringify(external)} || true; echo FG` },
      undefined,
      undefined,
      {} as never,
    );
    expect(foreground.content[0]).toMatchObject({ text: expect.stringContaining('FG') });
    const tools = await backgroundTools(
      { id: 'parent', publish() {}, async deliver() {} },
      privacyHost,
      '/usr/bin/bash',
      'export DELION_COMMAND_TOKEN=secret',
      null,
      roots(),
    );
    const background = tools.find((tool) => tool.name === 'bash')!;
    await background.execute(
      '2',
      {
        command: `echo no >> ${JSON.stringify(external)} || true; echo ${sessionId}; env | grep -q DELION_COMMAND_TOKEN && echo LEAK > /delivery/bg.txt || echo NO_TOKEN > /delivery/bg.txt`,
        background: true,
      },
      undefined,
      undefined,
      {} as never,
    );
    await expect.poll(() => readFileSync(join(deliveryHost, 'bg.txt'), 'utf8')).toBe('NO_TOKEN\n');
    expect(readFileSync(external, 'utf8')).toBe('ext');
    const logs = join(userData, 'background-tasks');
    await expect
      .poll(() =>
        readdirSync(logs)
          .map((name) => readFileSync(join(logs, name), 'utf8'))
          .join('\n'),
      )
      .toContain('[hidden]');
    const logged = readdirSync(logs)
      .map((name) => readFileSync(join(logs, name), 'utf8'))
      .join('\n');
    expect(logged).not.toContain(sessionId);
  });

  it('经父目录别名写外部文件失败，挂载表和命令回显不含会话 id', async () => {
    const viaParent = `/privacy/../..${external}`;
    const result = await runSandboxed(
      roots(),
      '/usr/bin/bash',
      [
        '-c',
        `echo pwned >> ${JSON.stringify(viaParent)} || true; readlink /etc/mtab || true; cat /etc/mtab || true`,
      ],
      { cwd: '/privacy' },
    );
    expect(readFileSync(external, 'utf8')).toBe('ext');
    expect(`${result.stdout.toString('utf8')}${result.stderr}`).not.toContain(sessionId);
    const echoed = await sandboxBash(roots(), `echo ${sessionId}`);
    expect(echoed.text).not.toContain(sessionId);
  });

  it('只读目录中的套接字、抽象套接字和多余文件描述符都不可用', async () => {
    const ipc = join(root, 'external', 'ipc.sock');
    const server = createServer();
    let accepted = false;
    server.on('connection', () => {
      accepted = true;
    });
    await new Promise<void>((resolve) => server.listen(ipc, () => resolve()));
    const abstract = spawn('python3', [
      '-c',
      [
        'import socket',
        'server = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)',
        'server.bind("\\0delion-bwrap-abstract")',
        'server.listen(1)',
        'server.settimeout(8)',
        'import pathlib',
        'try:',
        '    conn, _ = server.accept()',
        '    pathlib.Path("/tmp/delion-abstract-hit").write_text("yes")',
        '    conn.close()',
        'except Exception:',
        '    pass',
      ].join('\n'),
    ]);
    const probes = [
      [ipc, 'IPC'],
      ['/run/dbus/system_bus_socket', 'DBUS'],
      ['/var/run/docker.sock', 'DOCKER'],
      ['/run/host-services/ssh-auth.sock', 'SSH'],
    ];
    const script = [
      'import os, socket',
      'leaked = []',
      'for fd in range(3, 256):',
      '    try:',
      '        os.fstat(fd)',
      '        leaked.append(fd)',
      '    except OSError:',
      '        pass',
      'print("FDS", leaked)',
      'def probe(path, label):',
      '    client = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)',
      '    client.settimeout(1)',
      '    try:',
      '        client.connect(path)',
      '        print(label + "_OK")',
      '    except Exception:',
      '        print(label + "_FAIL")',
      '    finally:',
      '        client.close()',
      'probe("\\0delion-bwrap-abstract", "ABS")',
      ...probes.map(([path, label]) => `probe(${JSON.stringify(path)}, ${JSON.stringify(label)})`),
      'print("PTS", os.listdir("/dev/pts") if os.path.isdir("/dev/pts") else "NONE")',
      'print("SSH", os.environ.get("SSH_AUTH_SOCK"))',
      'print("WAYLAND", os.environ.get("WAYLAND_DISPLAY"))',
      'print("DBUS_ENV", os.environ.get("DBUS_SESSION_BUS_ADDRESS"))',
      'print("DISPLAY", os.environ.get("DISPLAY"))',
    ].join('\n');
    const result = await runSandboxed(roots(), '/usr/bin/python3', ['-c', script], {
      cwd: '/privacy',
    });
    abstract.kill();
    server.close();
    const output = result.stdout.toString('utf8') + result.stderr;
    expect(output).toContain('FDS []');
    expect(output).toContain('IPC_FAIL');
    expect(output).toContain('ABS_FAIL');
    expect(output).toContain('DBUS_FAIL');
    expect(output).toContain('DOCKER_FAIL');
    expect(output).toContain('SSH_FAIL');
    expect(output).toContain("PTS ['ptmx']");
    expect(output).toContain('SSH None');
    expect(output).toContain('WAYLAND None');
    expect(output).toContain('DBUS_ENV None');
    expect(output).toContain('DISPLAY None');
    expect(output).not.toContain(sessionId);
    expect(accepted).toBe(false);
    expect(existsSync('/tmp/delion-abstract-hit')).toBe(false);
  });

  it('取消长时间命令后不留下沙箱进程', async () => {
    const controller = new AbortController();
    const pending = runSandboxed(roots(), '/usr/bin/bash', ['-c', 'sleep 30'], {
      signal: controller.signal,
      cwd: '/privacy',
    });
    setTimeout(() => controller.abort(), 200);
    const started = Date.now();
    await pending;
    expect(Date.now() - started).toBeLessThan(5000);
    await new Promise((resolve) => setTimeout(resolve, 200));
    const ps = spawnSync('ps', ['-eo', 'args='], { encoding: 'utf8' });
    expect(ps.stdout).not.toContain('sleep 30');
  });
});

describe('平台不可用', () => {
  it('非 Linux 明确失败关闭', () => {
    if (process.platform === 'linux') {
      expect(linuxSandboxAvailability().ok).toBe(true);
      return;
    }
    const result = linuxSandboxAvailability();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain('尚未提供');
      expect(result.reason).toContain('没有改用本机权限');
    }
  });
});
