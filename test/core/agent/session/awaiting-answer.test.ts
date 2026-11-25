import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type Database from 'better-sqlite3';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { mockFrames, type MockOpenAiServer } from '../mock-openai-server';

const root = mkdtempSync(join(tmpdir(), 'delion-ask-user-'));
const state = vi.hoisted(() => ({
  db: null as Database.Database | null,
  provider: null as unknown,
}));
vi.mock('electron', () => ({ app: { getPath: () => root }, shell: {} }));
vi.mock('../../../../src/core/agent/providers', () => ({
  llmProviders: () => [state.provider],
  usableLlmProviders: () => [state.provider],
}));
vi.mock('../../../../src/core/agent/environment', () => ({
  agentEnvironment: () => ({
    sessionOptions: async () => ({
      appendSystemPrompt: [],
      customTools: [],
      shellPath: process.env.SHELL ?? 'bash',
      skillPaths: [],
      globalSkillDirs: [],
      disabledSkills: new Set(),
      disabledTools: [],
    }),
  }),
}));

import { provideTestHostPorts } from '../../host-mock';
import { askInput, startMockModel, stopMockModel } from '../../mock-model';
import { hostPorts } from '../../../../src/core/ports';
import { newSession } from '../../../../src/core/agent/session/commands';
import { askSession, shutdownSessions } from '../../../../src/core/agent/session/run';
import { preloadPi } from '../../../../src/core/agent/session/store';

let server: MockOpenAiServer;

beforeAll(async () => {
  provideTestHostPorts({ paths: { userData: () => root }, database: () => state.db! });
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

it('回合以 ask_user 结束时进入等待回答并提醒用户，而不是报告任务完成', async () => {
  const id = (await newSession(null)).sessionId!;
  server.enqueue({
    kind: 'sse',
    frames: [
      mockFrames.toolCallDelta({
        index: 0,
        id: 'call-ask',
        name: 'ask_user',
        arguments: JSON.stringify({
          questions: [{ question: '用哪种？', options: [{ label: 'A' }, { label: 'B' }] }],
        }),
      }),
      mockFrames.finishFrame('tool_calls'),
    ],
  });
  const requests = server.requests.length;
  await askSession(id, askInput('帮我选'));

  const { notifier, broadcaster } = hostPorts();
  expect(server.requests.length - requests).toBe(1);
  expect(notifier.notifyAwaitingAnswer).toHaveBeenCalledWith(id);
  expect(notifier.notifyRunFinished).not.toHaveBeenCalled();
  expect(broadcaster.send).toHaveBeenCalledWith(
    'agent:run-event',
    expect.objectContaining({ sessionId: id, status: 'waiting_input' }),
  );
});
