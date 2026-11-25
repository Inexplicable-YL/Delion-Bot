import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ToolDefinition } from '@earendil-works/pi-coding-agent';
import { hostPorts } from '../../ports';
import { helperSession, type ScopedCommandResult } from '../../remote/helper';
import { shellQuote } from '../../remote/transport';
import { notifyRemoteChange } from '../../remote/events';
import type { SessionRow } from '../session/store';
import { localBash } from '../tasks';
import { deniedMessage } from './approve-tool';
import { commandNames, readOnlyCommand } from './command-names';
import { macosSandboxLauncher, runMacosCommand } from './macos-command';
import { redactModelPaths } from './model-paths';
import {
  executionMode,
  launchPlan,
  ownerRow,
  scopedDirectories,
  type ScopedDirectory,
} from './mode';
import { readScopedReference, scopedFileTools } from './scoped-files';

const commandResult = (value: object, isError = false) => ({
  content: [{ type: 'text' as const, text: JSON.stringify(value) }],
  details: undefined,
  ...(isError ? { isError: true } : {}),
});

function brokerCommand(command: string, windows: boolean) {
  if (/[\r\n|&;<>$`%!^()]/.test(command)) return null;
  const input = command.trim();
  const tokens = [
    ...input.matchAll(
      windows
        ? /(?:^|[ \t]+)("[^"]*"|[^\s"]+)(?=[ \t]|$)/g
        : /(?:^|[ \t]+)("[^"]*"|'[^']*'|[^\s"']+)(?=[ \t]|$)/g,
    ),
  ];
  if (tokens.map(([match]) => match).join('') !== input) return null;
  const [name, ...args] = tokens.map(([, part]) => part!.replace(/^(['"])(.*)\1$/, '$2'));
  const program = windows ? name?.toLowerCase() : name;
  if (windows ? program === 'dir' : program === 'ls' || program === '/bin/ls') {
    const paths = args.filter((arg) => (windows ? arg.toLowerCase() !== '/b' : arg !== '--'));
    if (paths.length <= 1 && !paths[0]?.startsWith('-'))
      return { action: 'ls', params: { path: paths[0] } };
  }
  if (windows ? program === 'type' : program === 'cat' || program === '/bin/cat') {
    const paths = args.filter((arg) => windows || arg !== '--');
    if (paths.length === 1 && !paths[0]?.startsWith('-'))
      return { action: 'read', params: { path: paths[0] } };
  }
  if (
    !windows &&
    (program === 'grep' || program === '/usr/bin/grep') &&
    args.length === 2 &&
    !args[0]?.startsWith('-')
  )
    return { action: 'grep', params: { pattern: args[0], path: args[1] } };
  if (!windows && program === 'find' && args.length === 3 && args[1] === '-name')
    return { action: 'find', params: { path: args[0], pattern: args[2] } };
  if (program === 'mkdir' || (windows && program === 'md')) {
    const paths = args.filter((arg) => windows || (arg !== '-p' && arg !== '--'));
    if (paths.length === 1 && !paths[0]?.startsWith('-'))
      return { action: 'mkdir', params: { path: paths[0] } };
  }
  return null;
}

async function stageLocalInputs(directory: string, copies: readonly Buffer[]) {
  const inputs = join(directory, 'inputs');
  await mkdir(inputs, { mode: 0o700 });
  for (const [index, bytes] of copies.entries())
    await writeFile(join(inputs, String(index + 1)), bytes, { flag: 'wx', mode: 0o400 });
}

async function runApprovedCommand(
  root: ScopedDirectory,
  directories: ScopedDirectory[],
  command: string,
  copies: readonly Buffer[],
  signal: AbortSignal,
): Promise<ScopedCommandResult> {
  const maxOutputBytes = 50 * 1024;
  const chunks: Buffer[] = [];
  let bytes = 0;
  let truncated = false;
  const onData = (chunk: Buffer) => {
    const count = Math.min(chunk.length, maxOutputBytes - bytes);
    if (count) chunks.push(chunk.subarray(0, count));
    bytes += count;
    truncated ||= count < chunk.length;
  };
  const output = (temporary?: string) => {
    const text = Buffer.concat(chunks).toString('utf8');
    return `${temporary ? text.replaceAll(temporary, '.') : text}${truncated ? '\n[输出已截断]' : ''}`;
  };
  const timeout = 120;
  if (root.remote) {
    const helper = helperSession(root.remote);
    let scratch: string | undefined;
    try {
      signal.throwIfAborted();
      if (copies.length) {
        let path = '';
        const prepared = await helper.exec('mktemp -d /tmp/delion-command.XXXXXXXXXX', {
          cwd: root.host,
          signal,
          timeoutMs: 10_000,
          onData: (chunk) => (path += chunk.toString('utf8')),
        });
        path = path.trim();
        if (prepared.code !== 0 || !/^\/tmp\/delion-command\.[a-zA-Z0-9]{10}$/.test(path))
          throw new Error('无法创建远端命令临时目录');
        scratch = path;
        const inputs = await helper.exec('mkdir -m 700 inputs', {
          cwd: scratch,
          signal,
          timeoutMs: 10_000,
          onData: () => {},
        });
        if (inputs.code !== 0) throw new Error('无法创建远端命令输入目录');
        for (const [index, data] of copies.entries()) {
          signal.throwIfAborted();
          await helper.writeFile(`${scratch}/inputs/${index + 1}`, data);
        }
      }
      signal.throwIfAborted();
      const result = await helper.exec(command, {
        cwd: scratch ?? root.host,
        signal,
        timeoutMs: timeout * 1000,
        onData,
      });
      signal.throwIfAborted();
      return result.state === 'timeout'
        ? { exitCode: null, output: output(scratch), error: '命令执行超时' }
        : { exitCode: result.code, output: output(scratch) };
    } finally {
      if (scratch)
        await helper
          .exec(`rm -rf -- ${shellQuote(scratch)}`, {
            cwd: root.host,
            timeoutMs: 10_000,
            onData: () => {},
          })
          .catch(() => {});
      notifyRemoteChange(root.host);
    }
  }

  const windows = process.platform === 'win32';
  const shell = windows
    ? {
        shell: join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'cmd.exe'),
        args: ['/D', '/Q', '/S', '/C'],
        windowsVerbatimArguments: true,
      }
    : { shell: '/bin/bash', args: ['--noprofile', '--norc', '-c'] };
  const scratch =
    root.name !== '/project' || copies.length
      ? await mkdtemp(join(await realpath(tmpdir()), 'delion-command-'))
      : undefined;
  try {
    if (scratch && copies.length) await stageLocalInputs(scratch, copies);
    const chatDirectories = root.name === '/privacy' ? directories : [];
    if (scratch && chatDirectories.length) {
      for (const { name, host } of chatDirectories)
        await symlink(host, join(scratch, name.slice(1)), windows ? 'junction' : 'dir');
      command = command.replace(
        /(^|[\s"'=(,;<>|&])\/(privacy|share)(?=$|[\\/\s"'),;<>|&])/g,
        '$1$2',
      );
    }
    const result = await localBash(
      scratch ?? root.host,
      shell,
      undefined,
    )(command, {
      signal,
      timeout,
      onData,
    });
    signal.throwIfAborted();
    return {
      exitCode: result.exitCode ?? null,
      output: redactModelPaths(chatDirectories)(output(scratch)),
      ...(result.error && { error: result.error }),
    };
  } finally {
    if (scratch) await rm(scratch, { recursive: true, force: true });
  }
}

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
  if (mode === 'full') return null;
  const automatic = mode === 'auto-approval';
  const approvalMode = mode === 'approval' || automatic;
  const directories = scopedDirectories(meta);
  const owner = ownerRow(meta);
  const root: ScopedDirectory | undefined =
    directories[0] ??
    (approvalMode && owner.project_id
      ? { name: '/project', host: launchPlan(meta).hostCwd }
      : undefined);
  if (!root) return null;
  const remote = root.remote;
  const windows = !remote && process.platform === 'win32';
  const shell = windows ? 'cmd' : 'bash';
  const virtualRoots = root.name === '/privacy' ? ['/privacy', '/share'] : [];
  const launcher = windows
    ? join(hostPorts().paths.bundled('scopedfs'), 'scopedfs.exe')
    : macosSandboxLauncher;
  if (
    !approvalMode &&
    !remote &&
    ((!windows && process.platform !== 'darwin') || !existsSync(launcher))
  )
    return null;
  const { id: session } = owner;
  const fileTools = automatic ? scopedFileTools(meta) : [];
  const chatPaths =
    approvalMode && root.name === '/privacy'
      ? ` In ordinary local chats, use /privacy and /share in command text. Scripts started from the initial working directory can use the relative paths privacy and share.${windows ? ' Use backslashes after the virtual root in cmd.exe built-in file arguments.' : ''}`
      : '';
  const runtime = approvalMode
    ? `Run a ${windows ? 'Windows cmd.exe' : 'Bash'} command with the current ${remote ? 'SSH' : 'local'} account permissions after approval. Network and subprocesses are available. Project commands without input copies run in the project directory. Other commands run in a temporary directory.`
    : windows
      ? 'Run one Windows cmd.exe process using built-in commands such as type, dir and echo. Changes made inside the temporary working directory are discarded. Other processes and network are unavailable.'
      : `Run one ${remote ? 'remote Linux' : 'macOS'} Bash process. Use built-ins or exec with cat, ls, awk, grep, sed, sort or wc. The temporary working directory is read-only. Other processes and network are unavailable.`;
  return {
    name: 'sandbox_command',
    label: 'Sandbox command',
    description: `${automatic ? 'Simple read-only commands with relative paths, such as ls, cat, head, grep, find and wc, and directory creation run without approval. Use file tools for changes when possible. Other commands require approval. ' : ''}${runtime}${chatPaths} Input copies are available as inputs/1, inputs/2, and so on, in the order supplied. Use stdout for results.`,
    parameters: {
      type: 'object',
      properties: {
        command: { type: 'string', minLength: 1, maxLength: 2000 },
        files: { type: 'array', items: { type: 'string' }, maxItems: 8 },
      },
      required: ['command'],
    } as unknown as ToolDefinition['parameters'],
    async execute(
      id,
      { command, files = [] }: { command: string; files?: string[] },
      signal,
      onUpdate,
      context,
    ) {
      const cancellation = signal ?? new AbortController().signal;
      files = [...files];
      if (cancellation.aborted || command.includes('\0'))
        return commandResult({ error: '命令无效或已取消' }, true);
      const operation = automatic && brokerCommand(command, windows);
      if (operation) {
        const tool = fileTools.find(({ name }) => name === operation.action);
        if (tool) {
          const input =
            operation.action !== 'mkdir' && /^inputs[\\/](\d+)$/.exec(operation.params.path ?? '');
          const path = input ? files[Number(input[1]) - 1] : operation.params.path;
          if (!input || path)
            return tool.execute(id, { ...operation.params, path }, cancellation, onUpdate, context);
        }
      }
      if (approvalMode && !(automatic && readOnlyCommand(command, shell, virtualRoots))) {
        const names = commandNames(command, shell);
        const approval = await hostPorts().desktop.approveSandboxCommand?.({
          session,
          command,
          files,
          signal: cancellation,
          ...(remote && { remote: remote.host }),
          ...(names && {
            grant: {
              keys: names.map((name) => `host-command:${name}`),
              label: `运行 ${names.join('、')} 命令`,
            },
          }),
        });
        if (!approval?.approved || cancellation.aborted)
          return commandResult({ error: deniedMessage('命令未获批准', approval) }, true);
      }
      let directory: string | undefined;
      try {
        const runDirectories =
          approvalMode && root.name === '/privacy' ? scopedDirectories(meta) : directories;
        let remaining = 8 * 1024 * 1024;
        const copies = [];
        for (const path of files) {
          cancellation.throwIfAborted();
          const { data } = await readScopedReference(
            meta,
            path,
            'read',
            cancellation,
            runDirectories,
          );
          const bytes = Buffer.from(data ?? '', 'base64');
          remaining -= bytes.byteLength;
          if (remaining < 0) return commandResult({ error: '命令输入文件超过 8 MiB' }, true);
          copies.push(bytes);
        }
        cancellation.throwIfAborted();
        if (approvalMode) {
          const output = await runApprovedCommand(
            root,
            runDirectories,
            command,
            copies,
            cancellation,
          );
          return commandResult(output, output.exitCode !== 0);
        }
        if (remote) {
          const output = await helperSession(remote).scopedCommand(command, copies, cancellation);
          return commandResult(output, output.exitCode !== 0);
        }
        if (windows) {
          const output = await runWindowsCommand(launcher, command, copies, cancellation);
          return commandResult(output, output.exitCode !== 0);
        }
        directory = await mkdtemp(join(await realpath(tmpdir()), 'delion-command-'));
        await stageLocalInputs(directory, copies);
        cancellation.throwIfAborted();
        const output = await runMacosCommand(directory, command, cancellation);
        return commandResult(output, output.exitCode !== 0);
      } catch {
        return commandResult(
          { error: cancellation.aborted ? '命令已取消' : '无法运行命令或读取输入文件' },
          true,
        );
      } finally {
        if (directory) await rm(directory, { recursive: true, force: true });
      }
    },
  };
}
