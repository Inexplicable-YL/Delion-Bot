import { mkdtemp, mkdir, realpath, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runMacosCommand } from '../../../../src/core/agent/sandbox/macos-command';

describe.skipIf(process.platform !== 'darwin')('macOS 受限命令', () => {
  let root: string;
  let stage: string;
  let outside: string;
  const run = (script: string, signal = new AbortController().signal) =>
    runMacosCommand(stage, script, signal);

  beforeAll(async () => {
    root = await mkdtemp(join(await realpath(tmpdir()), 'delion-seatbelt-test-'));
    stage = join(root, 'stage');
    outside = join(root, 'outside');
    await mkdir(stage);
    await writeFile(join(stage, 'inside'), 'staged input');
    await writeFile(outside, 'outside input\n');
  });

  afterAll(() => rm(root, { recursive: true, force: true }));

  it('允许读取暂存文件和执行一个已授权的系统程序', async () => {
    await expect(run('exec /bin/cat ./inside')).resolves.toEqual({
      exitCode: 0,
      output: 'staged input',
    });
  });

  it('拒绝读取暂存区外的文件和向暂存区写入', async () => {
    const result = await run(
      'read -r outside < ../outside; read_code=$?; printf new > ./new; write_code=$?; test "$read_code" -ne 0 && test "$write_code" -ne 0',
    );
    expect(result.exitCode).toBe(0);
    expect(result.output).not.toContain('outside input');
  });

  it('拒绝子进程和本机回环连接', async () => {
    const server = createServer((socket) => socket.destroy());
    let connections = 0;
    server.on('connection', () => connections++);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('missing loopback address');
      const network = await run(`exec 3<>/dev/tcp/127.0.0.1/${address.port}`);
      expect(network.exitCode).not.toBe(0);
      expect(connections).toBe(0);
      const fork = await run('(printf child-output)');
      expect(fork.exitCode).not.toBe(0);
      expect(fork.output).not.toContain('child-output');
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  }, 13_000);

  it('取消运行中的命令', async () => {
    const controller = new AbortController();
    const pending = run('while :; do :; done', controller.signal);
    controller.abort();
    await expect(pending).resolves.toMatchObject({ exitCode: null });
  });
});
