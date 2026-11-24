import { createServer } from 'node:net';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { linuxSandboxAvailability, runSandboxed } from '../../../../src/core/agent/sandbox/linux';
import type { SandboxRoots } from '../../../../src/core/agent/sandbox/mode';
import { sandboxTools } from '../../../../src/core/agent/sandbox/tools';
import { provideTestHostPorts } from '../../host-mock';

const root = mkdtempSync(join('/home/ubuntu', 'delion-bwrap-'));
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
  rmSync(root, { recursive: true, force: true });
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
        command: `echo no >> ${JSON.stringify(external)} || true; env | grep -q DELION_COMMAND_TOKEN && echo LEAK > /delivery/bg.txt || echo NO_TOKEN > /delivery/bg.txt`,
        background: true,
      },
      undefined,
      undefined,
      {} as never,
    );
    await expect.poll(() => readFileSync(join(deliveryHost, 'bg.txt'), 'utf8')).toBe('NO_TOKEN\n');
    expect(readFileSync(external, 'utf8')).toBe('ext');
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
    if (!result.ok) expect(result.reason).toContain('没有改用当前用户的本机权限');
  });
});
