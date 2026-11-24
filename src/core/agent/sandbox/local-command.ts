import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ToolDefinition } from '@earendil-works/pi-coding-agent';
import { hostPorts } from '../../ports';
import { helperSession, type ScopedCommandResult } from '../../remote/helper';
import type { SessionRow } from '../session/store';
import { macosSandboxLauncher, runMacosCommand } from './macos-command';
import { executionMode, ownerRow, scopedDirectories } from './mode';
import { readScopedReference } from './scoped-files';

const commandResult = (value: object, isError = false) => ({
  content: [{ type: 'text' as const, text: JSON.stringify(value) }],
  details: undefined,
  ...(isError ? { isError: true } : {}),
});

export function runWindowsCommand(
  broker: string,
  command: string,
  inputs: readonly Buffer[],
  signal: AbortSignal,
): Promise<ScopedCommandResult> {
  return new Promise((resolve) => {
    const child = execFile(
      broker,
      ['--command'],
      { env: {}, windowsHide: true, timeout: 12_000, maxBuffer: 1024 * 1024 },
      (error, stdout) => {
        signal.removeEventListener('abort', cancel);
        if (!error && !signal.aborted) {
          try {
            resolve(JSON.parse(stdout));
            return;
          } catch {}
        }
        resolve({ exitCode: null, output: '', error: 'Windows 受限命令无法完成' });
      },
    );
    const cancel = () => child.stdin?.end();
    child.stdin?.on('error', () => {});
    if (signal.aborted) cancel();
    else {
      signal.addEventListener('abort', cancel, { once: true });
      child.stdin?.write(
        JSON.stringify({ command, inputs: inputs.map((bytes) => bytes.toString('base64')) }),
      );
    }
  });
}

export function sandboxCommandTool(meta: SessionRow): ToolDefinition | null {
  const mode = executionMode(meta);
  const root = scopedDirectories(meta)[0];
  if (mode === 'full' || !root) return null;
  const remote = root.remote;
  const windows = !remote && process.platform === 'win32';
  const launcher = windows
    ? join(hostPorts().paths.bundled('scopedfs'), 'scopedfs.exe')
    : macosSandboxLauncher;
  if (!remote && ((!windows && process.platform !== 'darwin') || !existsSync(launcher)))
    return null;
  const { id: session } = ownerRow(meta);
  const runtime = windows
    ? 'Run one Windows cmd.exe process using built-in commands such as type, dir and echo. Changes made inside the temporary working directory are discarded. Other processes and network are unavailable.'
    : `Run one ${remote ? 'remote Linux' : 'macOS'} Bash process. Use built-ins or exec with cat, ls, awk, grep, sed, sort or wc. The temporary working directory is read-only. Other processes and network are unavailable.`;
  return {
    name: 'sandbox_command',
    label: 'Sandbox command',
    description: `${runtime} Input copies are available as inputs/1, inputs/2, and so on, in the order supplied. Use stdout for results.`,
    parameters: {
      type: 'object',
      properties: {
        command: { type: 'string', minLength: 1, maxLength: 2000 },
        files: { type: 'array', items: { type: 'string' }, maxItems: 8 },
      },
      required: ['command'],
    } as unknown as ToolDefinition['parameters'],
    async execute(_id, { command, files = [] }: { command: string; files?: string[] }, signal) {
      const cancellation = signal ?? new AbortController().signal;
      if (cancellation.aborted || command.includes('\0'))
        return commandResult({ error: '命令无效或已取消' }, true);
      if (mode === 'approval') {
        const approved = await hostPorts().desktop.approveSandboxCommand?.({
          session,
          command,
          files,
          signal: cancellation,
          ...(remote && { remote: remote.host }),
        });
        if (!approved || cancellation.aborted)
          return commandResult({ error: '命令未获批准' }, true);
      }
      let directory: string | undefined;
      try {
        let remaining = 8 * 1024 * 1024;
        const copies = [];
        for (const path of files) {
          cancellation.throwIfAborted();
          const { data } = await readScopedReference(meta, path, 'read', cancellation);
          const bytes = Buffer.from(data ?? '', 'base64');
          remaining -= bytes.byteLength;
          if (remaining < 0) return commandResult({ error: '命令输入文件超过 8 MiB' }, true);
          copies.push(bytes);
        }
        cancellation.throwIfAborted();
        if (remote) {
          const output = await helperSession(remote).scopedCommand(command, copies, cancellation);
          return commandResult(output, output.exitCode !== 0);
        }
        if (windows) {
          const output = await runWindowsCommand(launcher, command, copies, cancellation);
          return commandResult(output, output.exitCode !== 0);
        }
        directory = await mkdtemp(join(await realpath(tmpdir()), 'delion-command-'));
        const inputs = join(directory, 'inputs');
        await mkdir(inputs, { mode: 0o700 });
        for (const [index, bytes] of copies.entries())
          await writeFile(join(inputs, String(index + 1)), bytes, { flag: 'wx', mode: 0o400 });
        cancellation.throwIfAborted();
        const output = await runMacosCommand(directory, command, cancellation);
        return commandResult(output, output.exitCode !== 0);
      } catch {
        return commandResult({ error: '无法在受限环境运行命令或读取输入' }, true);
      } finally {
        if (directory) await rm(directory, { recursive: true, force: true });
      }
    },
  };
}
