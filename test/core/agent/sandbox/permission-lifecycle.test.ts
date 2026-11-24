import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
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
import { setSessionPermissionMode, newSession } from '../../../../src/core/agent/session/commands';
import { askSession, shutdownSessions } from '../../../../src/core/agent/session/run';
import {
  chatShareDirectory,
  preloadPi,
  readPermissionMode,
  writePermissionMode,
} from '../../../../src/core/agent/session/store';
import { runningTasks } from '../../../../src/core/agent/tasks';
import { locateBash } from '../../../../src/modules/terminal';
import { provideTestHostPorts } from '../../host-mock';
import { askInput as input, reply, startMockModel, stopMockModel } from '../../mock-model';

provideTestHostPorts({
  database: () => state.db!,
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

it('回合中拒绝切换；完全权限的后台进程和命令桥在切到受限后不再保留', async () => {
  const parent = (await newSession(null)).sessionId!;
  writePermissionMode(parent, 'full');
  const marker = 'delion-perm-sleep-marker';
  server.enqueue(reply('先等着', 4000));
  const first = askSession(parent, input('第一轮'));
  await vi.waitFor(() => expect(sessionRunning(parent)).toBe(true), { timeout: 10_000 });
  expect(() => setSessionPermissionMode(parent, 'restricted')).toThrow('请等待当前回答完成');
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
  stopFull();

  const switched = setSessionPermissionMode(parent, 'restricted');
  expect(switched.permissionMode).toBe('restricted');
  expect(live.get(parent)).toBeUndefined();
  await vi.waitFor(() => expect(runningTasks(parent)).toEqual([]), { timeout: 10_000 });
  if (process.platform !== 'win32') {
    await new Promise((resolve) => setTimeout(resolve, 200));
    const ps = spawnSync('ps', ['-eo', 'args='], { encoding: 'utf8' });
    expect(ps.stdout).not.toContain(marker);
  }

  if (process.platform === 'linux') {
    const restrictedRequests: RecordedRequest[] = [];
    const stopRestricted = server.onRequest((request) => restrictedRequests.push(request));
    server.enqueue({
      kind: 'sse' as const,
      frames: [
        mockFrames.toolCallDelta({
          index: 0,
          id: 'call-env',
          name: 'bash',
          arguments: JSON.stringify({
            command: 'printf %s "${DELION_COMMAND_TOKEN-NO_TOKEN}" > /share/token.txt',
          }),
        }),
        mockFrames.finishFrame('tool_calls'),
      ],
    });
    server.enqueue(reply('受限'));
    await askSession(parent, input('再问'));
    const names = (
      (restrictedRequests.at(-1)?.body as { tools?: { function: { name: string } }[] } | undefined)
        ?.tools ?? []
    ).map((tool) => tool.function.name);
    expect(names).not.toContain('web_fetch');
    expect(names).not.toContain('session_read');
    expect(names).not.toContain('session_search');
    expect(names).toContain('bash');
    expect(JSON.stringify(restrictedRequests.at(-1)?.body)).toContain('/privacy');
    expect(readFileSync(join(chatShareDirectory(parent), 'token.txt'), 'utf8')).toBe('NO_TOKEN');
    stopRestricted();
    return;
  }
  await expect(askSession(parent, input('再问'))).rejects.toThrow(/没有改用本机权限/);
}, 30_000);
