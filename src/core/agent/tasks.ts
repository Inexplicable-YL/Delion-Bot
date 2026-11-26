import { spawn } from 'node:child_process';
import {
  createWriteStream,
  mkdirSync,
  openSync,
  readSync,
  closeSync,
  rmSync,
  statSync,
} from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { finished } from 'node:stream/promises';
import type { BashOperations, ToolDefinition } from '@earendil-works/pi-coding-agent';
import type { BackgroundTaskView, TaskNoticeDetails, TaskStatus } from '../protocol/agent';
import type { RemoteBackend } from '../remote/operations';
import { loadPi } from './pi';
import { hostPorts } from '../ports';

export interface TaskNotice {
  text: string;
  details: TaskNoticeDetails;
}

export interface TaskParent {
  id: string;
  publish(): void;
  deliver(notice: TaskNotice, wake: boolean): Promise<void>;
}

export interface TaskOutcome {
  status: Exclude<TaskStatus, 'running'>;
  exitCode?: number | null;
  reply?: string | null;
  error?: string;
}

interface BackgroundTask {
  id: string;
  parent: TaskParent;
  kind: 'bash' | 'subagent';
  label: string;
  startedAt: number;
  finishedAt?: number;
  status: TaskStatus;
  outcome?: TaskOutcome;
  stoppedBy?: 'user' | 'model' | 'session';
  stop: () => void;
  settled: Promise<void>;
  log?: string;
  tail: string;
}

const tasks = new Map<string, BackgroundTask>();
const TAIL_CHARS = 4000;
const NOTICE_LINES = 20;
const OUTPUT_LIMIT = 50 * 1024;
const EXIT_GRACE_MS = 100;

let logDirectory: string | undefined;
function logDir() {
  if (!logDirectory) {
    logDirectory = join(hostPorts().paths.userData(), 'background-tasks');
    rmSync(logDirectory, { recursive: true, force: true });
    mkdirSync(logDirectory, { recursive: true });
  }
  return logDirectory;
}

export function trackTask(
  task: Omit<BackgroundTask, 'startedAt' | 'status' | 'tail' | 'settled'> & { tail?: string },
  done: Promise<TaskOutcome>,
) {
  const entry: BackgroundTask = {
    ...task,
    tail: task.tail ?? '',
    startedAt: Date.now(),
    status: 'running',
    settled: done
      .catch((error: unknown): TaskOutcome => ({
        status: 'failed',
        error: error instanceof Error ? error.message : String(error),
      }))
      .then((outcome) => {
        if (entry.stoppedBy) outcome = { ...outcome, status: 'stopped' };
        Object.assign(entry, { status: outcome.status, outcome, finishedAt: Date.now() });
        if (entry.stoppedBy === 'session') return;
        entry.parent.publish();
        void entry.parent
          .deliver(notice(entry), entry.stoppedBy !== 'user')
          .catch((error: unknown) => console.error('后台任务通知投递失败', error));
      }),
  };
  tasks.set(entry.id, entry);
  entry.parent.publish();
}

export const taskRunning = (id: string) => tasks.get(id)?.status === 'running';

export function runningTasks(parentId: string): BackgroundTaskView[] {
  return [...tasks.values()]
    .filter((task) => task.parent.id === parentId && task.status === 'running')
    .map(({ id, kind, label, startedAt }) => ({ id, kind, label, startedAt }));
}

export function stopUserTask(parentId: string, id: string) {
  ownTask(parentId, id);
  stopTask(id, 'user');
}

export function stopTask(id: string, by: 'user' | 'model' | 'session') {
  const task = tasks.get(id);
  if (task?.status !== 'running') return;
  task.stoppedBy ??= by;
  task.stop();
}

export function stopSessionTasks(parentId: string) {
  for (const task of tasks.values()) if (task.parent.id === parentId) stopTask(task.id, 'session');
}

export async function stopAllTasks() {
  const running = [...tasks.values()].filter((task) => task.status === 'running');
  for (const task of running) stopTask(task.id, 'session');
  await Promise.all(running.map((task) => task.settled));
}

const statusText = (outcome: TaskOutcome) =>
  outcome.status === 'completed'
    ? 'completed'
    : outcome.status === 'stopped'
      ? 'stopped'
      : outcome.exitCode != null
        ? `failed (exit code ${outcome.exitCode})`
        : `failed${outcome.error ? `: ${outcome.error}` : ''}`;

function notice(task: BackgroundTask): TaskNotice {
  const outcome = task.outcome!;
  const durationMs = task.finishedAt! - task.startedAt;
  const tail = task.tail.split('\n').slice(-NOTICE_LINES).join('\n').trimEnd();
  const lines = [
    `Background task finished (taskId: ${task.id})`,
    task.kind === 'bash'
      ? `Source: bash\nCommand: ${task.label}`
      : `Source: subagent\nTask: ${task.label}`,
    `Status: ${statusText(outcome)}`,
    `Duration: ${(durationMs / 1000).toFixed(1)}s`,
    ...(task.stoppedBy === 'user'
      ? ['The user stopped it manually in the background task panel.']
      : []),
    task.kind === 'bash'
      ? tail
        ? `Output tail:\n\`\`\`\n${tail}\n\`\`\``
        : 'No output.'
      : outcome.reply
        ? `Final reply:\n${outcome.reply}`
        : 'No final reply.',
  ];
  return {
    text: lines.join('\n'),
    details: {
      taskId: task.id,
      kind: task.kind,
      label: task.label,
      status: outcome.status,
      ...(outcome.exitCode != null ? { exitCode: outcome.exitCode } : {}),
      durationMs,
      noticeId: randomUUID(),
    },
  };
}

export type BashRunner = (
  command: string,
  options: { signal: AbortSignal; timeout?: number; onData: (chunk: Buffer) => void },
) => Promise<TaskOutcome>;

export function localBash(
  operations: BashOperations,
  cwd: string,
  commandPrefix?: string,
  env: NodeJS.ProcessEnv = process.env,
): BashRunner {
  return async (command, options) => {
    try {
      const script = commandPrefix ? `${commandPrefix}\n${command}` : command;
      const { exitCode } = await operations.exec(script, cwd, { ...options, env });
      return { status: exitCode === 0 ? 'completed' : 'failed', exitCode };
    } catch (error) {
      if (options.signal.aborted) return { status: 'stopped' };
      const message = error instanceof Error ? error.message : String(error);
      return {
        status: 'failed',
        error: message.startsWith('timeout:') ? `Timed out (${options.timeout}s).` : message,
      };
    }
  };
}

export function localCmd(cwd: string, verifiedRead: boolean, env?: NodeJS.ProcessEnv): BashRunner {
  const system = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32');
  const args = ['/D', '/Q', '/S', ...(verifiedRead ? ['/V:OFF'] : []), '/C'];
  return (command, { signal, timeout, onData }) => {
    if (signal.aborted) return Promise.resolve({ status: 'stopped' });
    const child = spawn(join(system, 'cmd.exe'), [...args, `"${command}"`], {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      windowsVerbatimArguments: true,
      env,
    });
    let timedOut = false;
    let aborted = false;
    let finished = false;
    const forward = (chunk: Buffer) => {
      if (!finished) onData(chunk);
    };
    child.stdout?.on('data', forward);
    child.stderr?.on('data', forward);
    const stop = () => {
      if (!child.pid) return;
      const killer = spawn(join(system, 'taskkill.exe'), ['/F', '/T', '/PID', String(child.pid)], {
        stdio: 'ignore',
        windowsHide: true,
      });
      killer.once('error', () => {});
    };
    const onAbort = () => {
      aborted = true;
      stop();
    };
    signal.addEventListener('abort', onAbort, { once: true });
    const timer = timeout
      ? setTimeout(() => ((timedOut = true), stop()), timeout * 1000)
      : undefined;
    return new Promise<TaskOutcome>((resolve) => {
      let exitCode: number | null = null;
      let idle: NodeJS.Timeout | undefined;
      const finish = (outcome?: TaskOutcome) => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        clearTimeout(idle);
        signal.removeEventListener('abort', onAbort);
        child.stdout?.destroy();
        child.stderr?.destroy();
        if (outcome) resolve(outcome);
        else if (timedOut) resolve({ status: 'failed', error: `超时（${timeout} 秒）` });
        else if (aborted) resolve({ status: 'stopped', exitCode });
        else resolve({ status: exitCode === 0 ? 'completed' : 'failed', exitCode });
      };
      const settle = () => {
        clearTimeout(idle);
        idle = setTimeout(() => finish(), EXIT_GRACE_MS);
      };
      child.once('error', (error) => finish({ status: 'failed', error: error.message }));
      child.once('exit', (code) => {
        exitCode = code;
        settle();
        child.stdout?.on('data', settle);
        child.stderr?.on('data', settle);
      });
      child.once('close', () => finish());
    });
  };
}

function startBash(
  parent: TaskParent,
  command: string,
  timeout: number | undefined,
  run: BashRunner,
): string {
  const id = randomUUID();
  const log = join(logDir(), `${id}.log`);
  const file = createWriteStream(log);
  const abort = new AbortController();
  const onData = (chunk: Buffer) => {
    file.write(chunk);
    const task = tasks.get(id);
    if (task) task.tail = (task.tail + chunk.toString()).slice(-TAIL_CHARS);
  };
  const logClosed = finished(file, { cleanup: true });
  const execution = (async () => {
    try {
      return await run(command, { signal: abort.signal, timeout, onData });
    } finally {
      file.end();
    }
  })();
  trackTask(
    { id, parent, kind: 'bash', label: command, stop: () => abort.abort(), log },
    Promise.allSettled([execution, logClosed]).then(([outcome, logResult]) => {
      if (outcome.status === 'rejected') throw outcome.reason;
      if (logResult.status === 'rejected') throw logResult.reason;
      return outcome.value;
    }),
  );
  return id;
}

function readLog(log: string, offset: number | undefined) {
  const size = statSync(log).size;
  const start = Math.min(offset ?? Math.max(0, size - OUTPUT_LIMIT), size);
  const length = Math.min(OUTPUT_LIMIT, size - start);
  const buffer = Buffer.alloc(length);
  const fd = openSync(log, 'r');
  try {
    readSync(fd, buffer, 0, length, start);
  } finally {
    closeSync(fd);
  }
  return { text: buffer.toString(), start, end: start + length, size };
}

function ownTask(parentId: string, id: string, restricted = false): BackgroundTask {
  const task = tasks.get(id);
  if (task?.parent.id !== parentId || (restricted && task.kind !== 'subagent'))
    throw new Error(`No such background task: ${id}`);
  return task;
}

const text = (value: string) => ({
  content: [{ type: 'text' as const, text: value }],
  details: undefined,
});

export function taskControls(parent: TaskParent, restricted = false): ToolDefinition[] {
  return [
    {
      name: 'task_output',
      label: 'task_output',
      description: restricted
        ? 'Inspect the status and final reply of a subagent in this chat.'
        : 'Inspect the status and output of a background bash command or subagent. Bash returns status, exit code, and a chunk of output. Omit offset to read from the start, or the tail if the output is too long. Pass the previous nextOffset as offset to read new output. A subagent returns its status and final reply. Completion sends a notification, so polling is unnecessary.',
      parameters: {
        type: 'object',
        properties: {
          taskId: { type: 'string' },
          offset: { type: 'number', description: 'Byte offset to start reading from in the log.' },
        },
        required: ['taskId'],
      } as unknown as ToolDefinition['parameters'],
      async execute(_id, params: { taskId: string; offset?: number }) {
        const task = ownTask(parent.id, params.taskId, restricted);
        const status = task.outcome ? statusText(task.outcome) : 'running';
        if (task.kind === 'subagent')
          return text(
            [
              `Status: ${status}`,
              ...(task.outcome?.reply ? [`Final reply:\n${task.outcome.reply}`] : []),
            ].join('\n'),
          );
        const output = readLog(task.log!, params.offset);
        return text(
          [
            `Status: ${status}`,
            `Output (bytes ${output.start}–${output.end} of ${output.size}):`,
            output.text || '(no output)',
            `nextOffset: ${output.end}`,
          ].join('\n'),
        );
      },
    },
    {
      name: 'task_stop',
      label: 'task_stop',
      description: restricted
        ? 'Stop a background subagent in this chat.'
        : 'Stop a background task and its running work.',
      parameters: {
        type: 'object',
        properties: { taskId: { type: 'string' } },
        required: ['taskId'],
      } as unknown as ToolDefinition['parameters'],
      async execute(_id, params: { taskId: string }) {
        const task = ownTask(parent.id, params.taskId, restricted);
        if (task.status !== 'running')
          return text(`The task has already finished: ${statusText(task.outcome!)}`);
        stopTask(task.id, 'model');
        return text('Stopped.');
      },
    },
  ];
}

export async function backgroundTools(
  parent: TaskParent,
  cwd: string,
  shellPath: string,
  commandPrefix: string | undefined,
  remote: RemoteBackend | null,
): Promise<ToolDefinition[]> {
  const pi = await loadPi();
  const bash = remote
    ? pi.createBashToolDefinition(cwd, { operations: remote.bash })
    : pi.createBashToolDefinition(cwd, { shellPath, commandPrefix });
  const schema = bash.parameters as unknown as { properties: Record<string, unknown> };
  return [
    {
      ...bash,
      parameters: {
        ...schema,
        properties: {
          ...schema.properties,
          background: {
            type: 'boolean',
            description:
              'Set to true to run in the background and return taskId immediately. Use this for commands you do not need to wait for, such as development servers or long builds. Completion sends a notification. Use task_output to inspect output or task_stop to stop the task.',
          },
        },
      } as unknown as ToolDefinition['parameters'],
      async execute(
        toolCallId,
        params: { command: string; timeout?: number; background?: boolean },
        signal,
        onUpdate,
        ctx,
      ) {
        if (!params.background) return bash.execute(toolCallId, params, signal, onUpdate, ctx);
        const run: BashRunner = remote
          ? (command, options) => remote.runInBackground(command, cwd, options)
          : localBash(
              pi.createLocalBashOperations({ shellPath: pi.getShellConfig(shellPath).shell }),
              cwd,
              commandPrefix,
            );
        const id = startBash(parent, params.command, params.timeout, run);
        return text(
          `Running in the background (taskId: ${id}). You will be notified when it finishes; do not poll.`,
        );
      },
    } as ToolDefinition,
    ...taskControls(parent),
  ];
}
