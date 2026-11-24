import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runWindowsCommand } from '../../../../src/core/agent/sandbox/local-command';

const broker = resolve('.build', 'scopedfs', 'scopedfs.exe');

describe.skipIf(process.platform !== 'win32' || !existsSync(broker))('Windows 受限命令', () => {
  let root: string;
  let outside: string;
  const run = (command: string, inputs: Buffer[] = [], signal = new AbortController().signal) =>
    runWindowsCommand(broker, command, inputs, signal);

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'delion-win-sandbox-test-'));
    outside = join(root, 'outside.txt');
    await writeFile(outside, 'outside input');
  });

  afterAll(() => rm(root, { recursive: true, force: true }));

  it('只能读取暂存副本，不能读取或覆盖范围外的文件', async () => {
    await expect(run('type inputs\\1', [Buffer.from('staged input')])).resolves.toEqual({
      exitCode: 0,
      output: 'staged input',
    });
    const read = await run(`type "${outside}"`);
    expect(read.exitCode).toBeGreaterThan(0);
    expect(read.output).not.toContain('outside input');
    const write = await run(`echo changed > "${outside}"`);
    expect(write.exitCode).toBeGreaterThan(0);
    expect(await readFile(outside, 'utf8')).toBe('outside input');
  });

  it('阻止创建子进程', async () => {
    const result = await run('cmd.exe /D /C echo child-marker');
    expect(result.exitCode).toBeGreaterThan(0);
    expect(result.output).not.toContain('child-marker');
  });

  it('取消命令后返回受限运行错误', async () => {
    const controller = new AbortController();
    const pending = run('echo staged', [], controller.signal);
    controller.abort();
    await expect(pending).resolves.toMatchObject({ exitCode: null, error: expect.any(String) });
  });
});
