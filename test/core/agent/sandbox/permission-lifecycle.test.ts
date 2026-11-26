import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type Database from 'better-sqlite3';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import type { StoredLlmProvider } from '../../../../src/core/agent/llm-config';
import { mockFrames, type MockOpenAiServer, type RecordedRequest } from '../mock-openai-server';

const root = mkdtempSync(join(tmpdir(), 'delion-permission-lifecycle-'));
const state = vi.hoisted(() => ({
  db: null as Database.Database | null,
  provider: null as StoredLlmProvider | null,
}));
vi.mock('electron', () => ({
  app: { getPath: () => root, isPackaged: false, getAppPath: () => root },
}));
vi.mock('../../../../src/core/agent/providers', () => ({
  llmProviders: () => (state.provider ? [state.provider] : []),
  usableLlmProviders: () => (state.provider ? [state.provider] : []),
}));
vi.mock('../../../../src/core/capabilities/skills', () => ({
  builtinSkillsDirectory: () => join(root, 'skills'),
  ensureBuiltinSkills: () => {},
  effectiveDisabledSkills: () => new Set<string>(),
  globalSkillDirectories: () => [join(root, 'skills')],
  readDisabledSkillPaths: () => new Set<string>(),
}));
vi.mock('../../../../src/core/capabilities/mcp', () => ({
  mcpToolDefinitions: async () => [],
  executeMcpTool: vi.fn(),
}));
vi.mock('../../../../src/core/capabilities/command-server', () => ({
  COMMAND_BRIDGE: 'delion() { :; }',
  startDomainBridge: () => ({ url: 'http://127.0.0.1:9/', token: 'bridge-token', close() {} }),
}));
vi.mock('../../../../src/core/capabilities/tools', () => ({
  readDisabledTools: () => new Set<string>(),
}));
vi.mock('node-pty', () => ({ spawn: vi.fn() }));

import { live, sessionRunning } from '../../../../src/core/agent/session/live';
import {
  archiveProjectSessions,
  setSessionPermissionMode,
  newSession,
  updateSessionVisibility,
} from '../../../../src/core/agent/session/commands';
import { askSession, shutdownSessions } from '../../../../src/core/agent/session/run';
import {
  chatSessionDirectory,
  chatShareDirectory,
  preloadPi,
  readPermissionMode,
  writePermissionMode,
} from '../../../../src/core/agent/session/store';
import { runningTasks } from '../../../../src/core/agent/tasks';
import { locateBash } from '../../../../src/modules/terminal';
import { hostPorts } from '../../../../src/core/ports';
import { provideTestHostPorts } from '../../host-mock';
import { askInput as input, reply, startMockModel, stopMockModel } from '../../mock-model';

const confirmFullAccess =
  vi.fn<NonNullable<ReturnType<typeof hostPorts>['desktop']['confirmFullAccess']>>();
const approveFileChange =
  vi.fn<NonNullable<ReturnType<typeof hostPorts>['desktop']['approveFileChange']>>();
provideTestHostPorts({
  database: () => state.db!,
  desktop: { ...hostPorts().desktop, confirmFullAccess, approveFileChange },
  paths: {
    userData: () => join(root, 'user'),
    storage: () => join(root, 'storage'),
    home: () => root,
    temp: () => join(root, 'tmp'),
    documents: () => root,
    bash: locateBash,
  },
});

const backgroundBash = (command: string) => ({
  kind: 'sse' as const,
  frames: [
    mockFrames.toolCallDelta({
      index: 0,
      id: `call-${command.length}`,
      name: 'bash',
      arguments: JSON.stringify({ command, background: true }),
    }),
    mockFrames.finishFrame('tool_calls'),
  ],
});

let server: MockOpenAiServer;

beforeAll(async () => {
  const mock = await startMockModel();
  server = mock.server;
  state.provider = mock.provider;
  state.db = mock.db;
  await preloadPi();
});

afterAll(async () => {
  await shutdownSessions(1000);
  await stopMockModel({ server, db: state.db }, root);
});

it('完全访问在宿主明确确认后才生效', async () => {
  const parent = (await newSession(null)).sessionId!;
  state
    .db!.prepare('INSERT INTO workspace_settings VALUES (?, ?)')
    .run(`session-permission:${parent}`, 'full');
  expect(readPermissionMode(parent)).toBe('read-only');
  confirmFullAccess.mockResolvedValueOnce(false);
  expect((await setSessionPermissionMode(parent, 'full')).permissionMode).toBe('read-only');
  expect(readPermissionMode(parent)).toBe('read-only');

  let confirm!: (allow: boolean) => void;
  confirmFullAccess.mockReturnValueOnce(new Promise((resolve) => (confirm = resolve)));
  const pending = setSessionPermissionMode(parent, 'full');
  expect(readPermissionMode(parent)).toBe('read-only');
  confirm(true);
  expect((await pending).permissionMode).toBe('full');
  expect(confirmFullAccess).toHaveBeenLastCalledWith({
    session: parent,
    signal: expect.any(AbortSignal),
  });
  await setSessionPermissionMode(parent, 'read-only');
  confirmFullAccess.mockReturnValueOnce(new Promise((resolve) => (confirm = resolve)));
  const revoked = setSessionPermissionMode(parent, 'full');
  await setSessionPermissionMode(parent, 'approval');
  confirm(true);
  expect((await revoked).permissionMode).toBe('approval');
});

it('受限模型收到虚拟目录，现有消息中的宿主路径也会被替换', async () => {
  const id = (await newSession(null)).sessionId!;
  await setSessionPermissionMode(id, 'auto-approval');
  const privacy = chatSessionDirectory(id);
  const share = chatShareDirectory(id);
  const requests: RecordedRequest[] = [];
  const stop = server.onRequest((request) => requests.push(request));
  try {
    server.enqueue(reply('我看到了两个目录。'));
    await askSession(
      id,
      input(`核对 ${join(privacy, 'draft.txt')} 与 ${join(share, 'deliverable.txt')}`),
    );
    const context = JSON.stringify(requests.at(-1)?.body);
    expect(context).toContain('/privacy');
    expect(context).toContain('/share');
    expect(context).toContain('Mode: automatic approval');
    expect(context).not.toContain(JSON.stringify(privacy).slice(1, -1));
    expect(context).not.toContain(JSON.stringify(share).slice(1, -1));
    expect(context).not.toMatch(/[a-z]:\/privacy/i);
    expect(context).not.toContain('Pi documentation');
    expect(context).not.toContain('"name":"bash"');
  } finally {
    stop();
  }
});

it('回合中拒绝切换；完全权限的后台进程和命令桥在切到受限后不再保留', async () => {
  const parent = (await newSession(null)).sessionId!;
  writePermissionMode(parent, 'full');
  const marker = 'delion-perm-sleep-marker';
  server.enqueue(reply('先等着', 4000));
  const first = askSession(parent, input('第一轮'));
  await vi.waitFor(() => expect(sessionRunning(parent)).toBe(true), { timeout: 10_000 });
  await expect(setSessionPermissionMode(parent, 'read-only')).rejects.toThrow('请等待当前回答完成');
  expect(readPermissionMode(parent)).toBe('full');
  await first;

  const fullRequests: RecordedRequest[] = [];
  const stopFull = server.onRequest((request) => fullRequests.push(request));
  server.enqueue(backgroundBash(`sleep 20; echo ${marker}`));
  server.enqueue(reply('后台已起'));
  await askSession(parent, input('跑后台'));
  await vi.waitFor(() => expect(runningTasks(parent)).toHaveLength(1), { timeout: 10_000 });
  const fullTools = JSON.stringify(
    (fullRequests[0]?.body as { tools?: unknown[] } | undefined)?.tools ?? [],
  );
  expect(fullTools).toContain('web_fetch');
  expect(fullTools).toContain('session_read');
  expect(JSON.stringify(fullRequests[0]?.body)).toContain('Mode: full access');
  stopFull();

  const switched = await setSessionPermissionMode(parent, 'read-only');
  expect(switched.permissionMode).toBe('read-only');
  expect(live.get(parent)).toBeUndefined();
  await vi.waitFor(() => expect(runningTasks(parent)).toEqual([]), { timeout: 10_000 });
  if (process.platform !== 'win32') {
    await new Promise((resolve) => setTimeout(resolve, 200));
    const ps = spawnSync('ps', ['-eo', 'args='], { encoding: 'utf8' });
    expect(ps.stdout).not.toContain(marker);
  }

  const restrictedRequests: RecordedRequest[] = [];
  const stopRestricted = server.onRequest((request) => restrictedRequests.push(request));
  server.enqueue(reply('只读'));
  await askSession(parent, input('再问'));
  const names = (
    (restrictedRequests.at(-1)?.body as { tools?: { function: { name: string } }[] } | undefined)
      ?.tools ?? []
  ).map((tool) => tool.function.name);
  expect(names.sort()).toEqual([
    'ask_user',
    'delion',
    'find',
    'grep',
    'ls',
    'read',
    'read_skill',
    'sandbox_command',
    'session_read',
    'session_search',
    'task',
    'task_output',
    'task_stop',
    'web_fetch',
    'web_search',
  ]);
  const restrictedContext = JSON.stringify(restrictedRequests.at(-1)?.body);
  expect(restrictedContext).toContain('/privacy');
  expect(restrictedContext).toContain('Mode: read-only');
  expect(restrictedContext).not.toContain('Mode: full access');
  stopRestricted();
}, 30_000);

it.each([
  ['归档会话', (id: string) => updateSessionVisibility(id, { archived: true })],
  ['批量归档', () => archiveProjectSessions(null)],
] as const)('%s取消正在等待批准的写入', async (_label, archive) => {
  const id = (await newSession(null)).sessionId!;
  await setSessionPermissionMode(id, 'approval');
  const destination = join(chatShareDirectory(id), 'archived.txt');
  let approvalSignal: AbortSignal | undefined;
  approveFileChange.mockImplementationOnce(({ signal }) => {
    approvalSignal = signal;
    return new Promise((resolve) =>
      signal.addEventListener('abort', () => resolve({ approved: true }), { once: true }),
    );
  });
  server.enqueue({
    kind: 'sse',
    frames: [
      mockFrames.toolCallDelta({
        index: 0,
        id: 'archive-write',
        name: 'write',
        arguments: JSON.stringify({ path: '/share/archived.txt', content: 'pending' }),
      }),
      mockFrames.finishFrame('tool_calls'),
    ],
  });
  const run = askSession(id, input('写入测试文件'));
  await vi.waitFor(() => expect(approvalSignal).toBeDefined());
  archive(id);
  await run;
  expect(approvalSignal?.aborted).toBe(true);
  expect(existsSync(destination)).toBe(false);
  await expect(askSession(id, input('再次写入'))).rejects.toThrow('请先恢复已归档的会话');
});
