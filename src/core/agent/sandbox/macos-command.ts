import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ToolDefinition } from '@earendil-works/pi-coding-agent';
import { hostPorts } from '../../ports';
import type { SessionRow } from '../session/store';
import { executionMode, ownerRow, scopedDirectories } from './mode';
import { readScopedReference } from './scoped-files';

const launcher = '/usr/bin/sandbox-exec';
const shell = '/bin/bash';
const programs = [
  shell,
  '/bin/cat',
  '/bin/ls',
  '/usr/bin/awk',
  '/usr/bin/grep',
  '/usr/bin/sed',
  '/usr/bin/sort',
  '/usr/bin/wc',
];
const executablePaths = programs.map((path) => `(literal "${path}")`).join(' ');
const profile = `(version 1)
(deny default (with message "delion-command"))
(allow process-exec ${executablePaths})
(allow file-map-executable (subpath "/usr/lib") (subpath "/System/Library") ${executablePaths})
(allow file-read* file-map-executable
  (subpath "/System/Cryptexes/OS") (subpath "/System/Volumes/Preboot/Cryptexes/OS"))
(allow file-read* (subpath (param "INPUTS")) (subpath "/usr/lib") (subpath "/System/Library")
  (literal "/dev/null") (literal "/dev/zero") (literal "/dev/random") (literal "/dev/urandom")
  ${executablePaths})
(allow file-read-metadata file-test-existence (path-ancestors (param "INPUTS")))
(allow file-read-data (require-all (literal "/") (vnode-type DIRECTORY)))
(allow process-info-pidinfo (target self))
(allow signal (target self))
(allow file-write-data (literal "/dev/null"))
(allow sysctl-read (sysctl-name-prefix "hw.optional.arm") (sysctl-name "kern.osvariant_status")
  (sysctl-name "hw.pagesize") (sysctl-name "hw.cpufamily") (sysctl-name "hw.cputype")
  (sysctl-name "security.mac.lockdown_mode_state"))
(allow system-mac-syscall (require-all (mac-policy-name "Sandbox") (mac-syscall-number 67)))
(allow system-mac-syscall (mac-policy-name "vnguard"))
`;

export function runMacosCommand(directory: string, command: string, signal: AbortSignal) {
  return new Promise<{ exitCode: number | null; output: string }>((resolve) => {
    const child = execFile(
      launcher,
      ['-D', `INPUTS=${directory}`, '-p', profile, shell, '--noprofile', '--norc', '-c', command],
      {
        cwd: directory,
        env: { PATH: '/usr/bin:/bin', LC_ALL: 'C' },
        signal,
        killSignal: 'SIGKILL',
        timeout: 8_000,
        maxBuffer: 128 * 1024,
      },
      (error, stdout, stderr) => {
        const output = (`${stdout}${stderr}` || error?.signal || '').replaceAll(directory, '.');
        resolve({
          exitCode: error ? (typeof error.code === 'number' ? error.code : null) : 0,
          output,
        });
      },
    );
    child.stdin?.on('error', () => {});
    child.stdin?.end();
  });
}

export function macosCommandTool(meta: SessionRow): ToolDefinition | null {
  if (process.platform !== 'darwin' || !existsSync(launcher)) return null;
  const mode = executionMode(meta);
  const roots = scopedDirectories(meta);
  if (mode === 'full' || !roots.length || roots.some(({ remote }) => remote)) return null;
  const { id: session } = ownerRow(meta);
  const result = (value: object, isError = false) => ({
    content: [{ type: 'text' as const, text: JSON.stringify(value) }],
    details: undefined,
    ...(isError ? { isError: true } : {}),
  });
  return {
    name: 'sandbox_command',
    label: 'Sandbox command',
    description:
      'Run one macOS Bash process with optional copies of current chat files. Files arrive under inputs/1, inputs/2, and so on, in the order supplied. The filesystem is read-only and network and subprocesses are unavailable. Use Bash built-ins or exec with cat, ls, awk, grep, sed, sort or wc. Use stdout for results.',
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
        return result({ error: '命令无效或已取消' }, true);
      if (mode === 'approval') {
        const approved = await hostPorts().desktop.approveSandboxCommand?.({
          session,
          command,
          files,
          signal: cancellation,
        });
        if (!approved || cancellation.aborted) return result({ error: '命令未获批准' }, true);
      }
      let directory: string | undefined;
      try {
        directory = await mkdtemp(join(await realpath(tmpdir()), 'delion-command-'));
        const inputs = join(directory, 'inputs');
        await mkdir(inputs, { mode: 0o700 });
        let remaining = 8 * 1024 * 1024;
        for (const [index, path] of files.entries()) {
          cancellation.throwIfAborted();
          const { data } = await readScopedReference(meta, path, 'read', cancellation);
          const bytes = Buffer.from(data ?? '', 'base64');
          remaining -= bytes.byteLength;
          if (remaining < 0) return result({ error: '命令输入文件超过 8 MiB' }, true);
          await writeFile(join(inputs, String(index + 1)), bytes, { flag: 'wx', mode: 0o400 });
        }
        cancellation.throwIfAborted();
        const output = await runMacosCommand(directory, command, cancellation);
        return result(output, output.exitCode !== 0);
      } catch {
        return result({ error: '无法在受限环境运行命令或读取输入' }, true);
      } finally {
        if (directory) await rm(directory, { recursive: true, force: true });
      }
    },
  };
}
