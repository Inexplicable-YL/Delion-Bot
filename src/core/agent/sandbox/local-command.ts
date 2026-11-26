import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, isAbsolute, join, posix } from 'node:path';
import type { ToolDefinition } from '@earendil-works/pi-coding-agent';
import { hostPorts } from '../../ports';
import { helperSession, type ScopedCommandResult } from '../../remote/helper';
import { shellQuote, targetKey } from '../../remote/transport';
import { notifyRemoteChange } from '../../remote/events';
import type { SessionRow } from '../session/store';
import { loadPi } from '../pi';
import { localBash, localCmd } from '../tasks';
import { deniedMessage } from './approve-tool';
import { commandNames, literalCommands, readOnlyCommand } from './command-names';
import { commandPlan, commandPlanPermissions, executeCommandPlan } from './command-plan';
import { CommandOutput } from './command-output';
import { macosSandboxLauncher, runMacosCommand } from './macos-command';
import { redactModelPaths } from './model-paths';
import {
  executionMode,
  launchPlan,
  ownerRow,
  scopedDirectories,
  type ScopedDirectory,
} from './mode';
import { commandCopyTarget, copyCommandFile, readScopedReference } from './scoped-files';

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
  if (windows && (program === 'get-childitem' || program === 'get-content')) {
    const [option, value] = args;
    const path = args.length === 2 && /^-(?:literal)?path$/i.test(option ?? '') ? value : option;
    if (path?.startsWith('-') || args.length > (path === option ? 1 : 2)) return null;
    if (program === 'get-childitem') return { action: 'ls', params: { path } };
    if (path) return { action: 'read', params: { path } };
  }
  if (windows ? program === 'dir' || program === 'ls' : program === 'ls' || program === '/bin/ls') {
    const paths = args.filter((arg) => (windows ? arg.toLowerCase() !== '/b' : arg !== '--'));
    if (paths.length <= 1 && !paths[0]?.startsWith('-'))
      return { action: 'ls', params: { path: paths[0] } };
  }
  if (
    windows ? program === 'type' || program === 'cat' : program === 'cat' || program === '/bin/cat'
  ) {
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
  if (program === 'rg' && args.length >= 1 && args.length <= 2 && !args[0]!.startsWith('-'))
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
  capture: CommandOutput,
  verifiedRead = false,
): Promise<ScopedCommandResult> {
  const onData = (chunk: Buffer) => capture.append(chunk);
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
          throw new Error('Unable to create the remote command scratch directory.');
        scratch = path;
        const inputs = await helper.exec('mkdir -m 700 inputs', {
          cwd: scratch,
          signal,
          timeoutMs: 10_000,
          onData: () => {},
        });
        if (inputs.code !== 0)
          throw new Error('Unable to create the remote command input directory.');
        for (const [index, data] of copies.entries()) {
          signal.throwIfAborted();
          await helper.writeFile(`${scratch}/inputs/${index + 1}`, data);
        }
      }
      signal.throwIfAborted();
      const result = await helper.exec(
        verifiedRead
          ? `/usr/bin/env -i PATH=/usr/bin:/bin /bin/bash --noprofile --norc -c ${shellQuote(command)}`
          : command,
        {
          cwd: scratch ?? root.host,
          signal,
          timeoutMs: timeout * 1000,
          onData,
          ...(verifiedRead && { env: { BASH_ENV: '' } }),
        },
      );
      signal.throwIfAborted();
      return {
        ...(result.state === 'timeout'
          ? { exitCode: null, error: 'Command timed out.' }
          : { exitCode: result.code }),
        ...(await capture.result(
          (text) => (scratch ? text.replaceAll(scratch, '.') : text),
          !result.lost,
        )),
        ...(result.lost && { error: `SSH transfer lost ${result.lost} bytes of output.` }),
      };
    } finally {
      if (scratch)
        await helper
          .exec(`rm -rf -- ${shellQuote(scratch)}`, {
            cwd: root.host,
            timeoutMs: 10_000,
            onData: () => {},
          })
          .catch(() => {});
      if (!verifiedRead) notifyRemoteChange(root.host);
    }
  }

  const windows = process.platform === 'win32';
  const system = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32');
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
    const environment = verifiedRead
      ? {
          ...(windows
            ? {
                SystemRoot: process.env.SystemRoot ?? 'C:\\Windows',
                PATH: [system, join(system, '..')].join(delimiter),
                PATHEXT: '.COM;.EXE',
                NoDefaultCurrentDirectoryInExePath: '1',
              }
            : { PATH: '/usr/bin:/bin', LANG: process.env.LANG }),
        }
      : undefined;
    const cwd = scratch ?? root.host;
    const run = windows
      ? localCmd(cwd, verifiedRead, environment)
      : localBash(
          (await loadPi()).createLocalBashOperations({ shellPath: '/bin/bash' }),
          cwd,
          undefined,
          environment,
        );
    const result = await run(command, {
      signal,
      timeout,
      onData,
    });
    signal.throwIfAborted();
    const redact = redactModelPaths(chatDirectories);
    return {
      exitCode: result.exitCode ?? null,
      ...(await capture.result((text) => redact(scratch ? text.replaceAll(scratch, '.') : text))),
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
        resolve({
          exitCode: null,
          output: '',
          error: 'The scoped Windows command did not complete.',
        });
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

function analyzeCommand(
  command: string,
  shell: 'bash' | 'cmd',
  root: ScopedDirectory,
  directories: ScopedDirectory[],
  hasInputs: boolean,
  isolated: boolean,
) {
  if (directories.length) {
    const windows = shell === 'cmd';
    const file = brokerCommand(command, windows);
    const plan = commandPlan(command, shell, directories, hasInputs);
    if (file) {
      const path = file.params.path;
      const hostPath = Boolean(
        path &&
        (root.remote ? posix.isAbsolute(path) : isAbsolute(path)) &&
        !/^\/(?:project|privacy|share)(?:[\\/]|$)/.test(path) &&
        (!windows || /^\s*(?:"(?:dir|type)"|dir|type)\s/i.test(command)),
      );
      return { kind: 'file' as const, file, plan, hostPath, readOnly: file.action !== 'mkdir' };
    }
    if (!hasInputs && !root.remote) {
      const commands = literalCommands(command, shell);
      const [name, ...args] = commands?.length === 1 ? commands[0]! : [];
      if (name === 'cp' || (windows && name?.toLowerCase() === 'copy')) {
        if (args[0] === '--' && name === 'cp') args.shift();
        const [source, destination] = args;
        if (
          args.length === 2 &&
          source &&
          destination &&
          !source.startsWith('-') &&
          !destination.startsWith('-') &&
          !/[?*]/.test(source + destination)
        ) {
          const target = commandCopyTarget(directories, destination);
          if (target) return { kind: 'copy' as const, source, target, readOnly: false };
        }
      }
    }
    if (plan) return { kind: 'plan' as const, plan, readOnly: plan.readOnly };
  }
  const roots = root.name === '/privacy' ? ['/privacy', '/share'] : hasInputs ? [] : ['/project'];
  return {
    kind: 'shell' as const,
    readOnly: directories.length > 0 && readOnlyCommand(command, shell, roots),
    isolated:
      isolated && hasInputs && /^(?:exec\s+)?(?:\/(?:bin|usr\/bin)\/)?(?:awk|sed)\s/.test(command),
  };
}

export function sandboxCommandTool(
  meta: SessionRow,
  fileTools: ToolDefinition[],
): ToolDefinition | null {
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
  const isolated =
    Boolean(remote) || (process.platform === 'darwin' && existsSync(macosSandboxLauncher));
  const { id: session } = owner;
  return {
    name: 'sandbox_command',
    label: 'Sandbox command',
    description: `Run a command under the current session permissions. Native syntax is ${windows ? 'cmd.exe' : 'Bash'}. Use the scoped examples in the permission instructions. Optional files are addressed as inputs/1, inputs/2, and so on. Use stdout for results.`,
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
        return commandResult({ error: 'The command is invalid or was cancelled.' }, true);
      const analysis = analyzeCommand(
        command,
        shell,
        root,
        directories,
        files.length > 0,
        isolated,
      );
      const isolatedRead = mode === 'read-only' && analysis.kind === 'shell' && analysis.isolated;
      if (mode === 'read-only' && !analysis.readOnly && !isolatedRead)
        return commandResult(
          { error: 'Read-only mode only runs commands verified to make no changes.' },
          true,
        );
      const approvedHostFile = mode === 'approval' && analysis.kind === 'file' && analysis.hostPath;
      const plan =
        analysis.kind === 'plan' || (analysis.kind === 'file' && !approvedHostFile)
          ? analysis.plan
          : null;
      const delegatedMkdir =
        analysis.kind === 'file' &&
        analysis.file.action === 'mkdir' &&
        !approvedHostFile &&
        !plan &&
        fileTools.some(({ name }) => name === 'mkdir');
      if (
        (mode === 'approval' && !delegatedMkdir) ||
        (automatic && (plan?.requiresApproval || (analysis.kind === 'shell' && !analysis.readOnly)))
      ) {
        const permissions = plan
          ? commandPlanPermissions(plan)
          : analysis.kind === 'copy'
            ? [
                {
                  key: ['copy', analysis.target.root.name, analysis.target.root.host],
                  label: `复制文件到 ${analysis.target.root.name}`,
                },
              ]
            : [];
        const names = permissions.length ? null : commandNames(command, shell);
        const grant = permissions.length
          ? {
              keys: [
                ...new Set(
                  permissions.map(
                    ({ key }) =>
                      'broker-command:' +
                      JSON.stringify([root.host, remote ? targetKey(remote) : 'local', ...key]),
                  ),
                ),
              ],
              label: [...new Set(permissions.map(({ label }) => label))].join('、'),
            }
          : names
            ? {
                keys: names.map(
                  (name) =>
                    'host-command:' +
                    JSON.stringify([remote ? targetKey(remote) : 'local', root.host, name]),
                ),
                label: `运行 ${names.join('、')} 命令`,
              }
            : undefined;
        const approval = await hostPorts().desktop.approve?.({
          kind: 'command',
          session,
          command,
          files,
          signal: cancellation,
          ...(remote && { remote: remote.host }),
          ...(grant && { grant }),
        });
        if (!approval?.approved || cancellation.aborted)
          return commandResult({ error: deniedMessage('Command not approved', approval) }, true);
      }
      if (analysis.kind === 'file' && !approvedHostFile && (mode !== 'approval' || !plan)) {
        const operation = analysis.file;
        const tool = fileTools.find(({ name }) => name === operation.action);
        if (tool) {
          const input =
            operation.action !== 'mkdir' && /^inputs[\\/](\d+)$/.exec(operation.params.path ?? '');
          const path = input ? files[Number(input[1]) - 1] : operation.params.path;
          if (!input || path)
            return tool.execute(id, { ...operation.params, path }, cancellation, onUpdate, context);
        }
        if (!plan && mode !== 'approval')
          return commandResult({ error: 'Unable to read the file required by the command.' }, true);
      }
      if (analysis.kind === 'copy') {
        try {
          const result = await copyCommandFile(
            directories,
            analysis.source,
            analysis.target,
            cancellation,
          );
          return commandResult(
            { exitCode: result.error ? 1 : 0, output: '', ...result },
            Boolean(result.error),
          );
        } catch {
          return commandResult({ error: 'Unable to copy the file.' }, true);
        }
      }
      const capture = new CommandOutput(session);
      if (plan) {
        try {
          const result = await executeCommandPlan(
            plan,
            directories,
            files,
            session,
            cancellation,
            (text) => capture.append(Buffer.from(text)),
          );
          return commandResult(
            {
              ...result,
              ...(await capture.result(redactModelPaths(directories), !result.output_truncated)),
            },
            result.exitCode !== 0,
          );
        } catch (error) {
          return commandResult(
            {
              ...(await capture.result(redactModelPaths(directories))),
              error:
                error instanceof Error
                  ? redactModelPaths(directories)(error.message)
                  : 'Unable to complete the command read.',
            },
            true,
          );
        }
      }
      const verifiedRead = mode !== 'approval' && analysis.kind === 'shell' && analysis.readOnly;
      let directory: string | undefined;
      try {
        const runDirectories = root.name === '/privacy' ? scopedDirectories(meta) : directories;
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
          if (remaining < 0)
            return commandResult({ error: 'The command input files exceed 8 MiB.' }, true);
          copies.push(bytes);
        }
        cancellation.throwIfAborted();
        if (approvalMode || verifiedRead) {
          const script =
            verifiedRead && root.name === '/project'
              ? command.replace(/(^|[\s"'=])\/project(?=$|[\\/\s"'])/g, '$1.')
              : command;
          const output = await runApprovedCommand(
            root,
            runDirectories,
            script,
            copies,
            cancellation,
            capture,
            verifiedRead,
          );
          return commandResult(output, output.exitCode !== 0 || Boolean(output.error));
        }
        if (remote) {
          const output = await helperSession(remote).scopedCommand(command, copies, cancellation);
          return commandResult(output, output.exitCode !== 0);
        }
        directory = await mkdtemp(join(await realpath(tmpdir()), 'delion-command-'));
        await stageLocalInputs(directory, copies);
        cancellation.throwIfAborted();
        const output = await runMacosCommand(directory, command, cancellation);
        return commandResult(output, output.exitCode !== 0);
      } catch {
        return commandResult(
          {
            ...(await capture.result(redactModelPaths(directories))),
            error: cancellation.aborted
              ? 'The command was cancelled.'
              : 'Unable to run the command or read the input files.',
          },
          true,
        );
      } finally {
        if (directory) await rm(directory, { recursive: true, force: true });
      }
    },
  };
}
