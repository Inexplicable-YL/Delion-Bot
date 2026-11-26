import type { AgentMessage } from '@earendil-works/pi-agent-core';
import type { SessionEntry } from '@earendil-works/pi-coding-agent';
import { expect, it } from 'vitest';
import {
  COMPACTION_DETAILS,
  projectAfterCompaction,
  projectCompactionHistory,
  projectLiveMessages,
  projectMessages,
  thinkingKey,
  thinkingTimes,
  THINKING_TIME,
} from '../../../../src/core/agent/session/projection';
import { preloadPi, requirePiSync } from '../../../../src/core/agent/session/store';

it('思考时长从会话里的自定义记录还原，进行中的时长覆盖已保存值', () => {
  const branch = [
    {
      type: 'custom',
      customType: THINKING_TIME,
      data: {
        [thinkingKey(20, 0)]: { startedAt: 1000, finishedAt: 13500 },
        [thinkingKey(30, 0)]: { startedAt: 1, finishedAt: 2 },
      },
    },
    { type: 'custom', customType: THINKING_TIME, data: { broken: { startedAt: 'x' } } },
  ] as unknown as SessionEntry[];
  const times = thinkingTimes(
    { getBranch: () => branch },
    new Map([[thinkingKey(30, 0), { startedAt: 5000 }]]),
  );
  const messages = [
    { role: 'user', content: '想一想', timestamp: 10 },
    {
      role: 'assistant',
      content: [
        { type: 'thinking', thinking: '先想清楚' },
        { type: 'text', text: '好了' },
      ],
      stopReason: 'stop',
      timestamp: 20,
    },
  ] as unknown as AgentMessage[];
  const [, reply] = projectMessages(messages, undefined, false, undefined, times);
  expect(reply!.parts![0]).toEqual({
    type: 'reasoning',
    text: '先想清楚',
    startedAt: 1000,
    finishedAt: 13500,
  });
  expect(times.get(thinkingKey(30, 0))).toEqual({ startedAt: 5000 });
  expect(times.has('broken')).toBe(false);
});

it('重新打开压缩会话时，分隔线在当时最后一条消息之后，模型仍只保留选中的上下文', async () => {
  await preloadPi();
  const manager = requirePiSync().SessionManager.inMemory();
  manager.appendMessage({ role: 'user', content: '早期请求', timestamp: 1 });
  const kept = manager.appendMessage({ role: 'user', content: '保留的请求', timestamp: 2 });
  const reply = {
    role: 'assistant',
    content: [{ type: 'text', text: '压缩前的回复' }],
    stopReason: 'stop',
    timestamp: 3,
  } as Extract<AgentMessage, { role: 'assistant' }>;
  manager.appendMessage(reply);
  const entryId = manager.appendCompaction('压缩摘要', kept, 120_000);
  manager.appendCustomEntry(COMPACTION_DETAILS, {
    id: entryId,
    mode: 'manual',
    releasedTokens: 100_000,
  });

  expect(projectCompactionHistory(manager.getBranch()).map(({ content }) => content)).toEqual([
    '早期请求',
    '保留的请求',
    '压缩前的回复',
    '压缩摘要',
  ]);
  expect(projectCompactionHistory(manager.getBranch()).at(-1)).toMatchObject({
    entryId,
    compacted: true,
    compaction: { mode: 'manual', releasedTokens: 100_000 },
  });
  expect(projectAfterCompaction('closed', manager.getBranch())).toEqual({ entryId, messages: [] });
  expect(manager.buildSessionProjection().messages.filter(({ role }) => role === 'user')).toEqual([
    { role: 'user', content: '保留的请求', timestamp: 2 },
  ]);

  manager.appendMessage({
    ...reply,
    content: [{ type: 'text', text: '压缩后继续回复' }],
    timestamp: 4,
  });
  expect(
    projectAfterCompaction('closed', manager.getBranch())?.messages.map(({ content }) => content),
  ).toEqual(['压缩后继续回复']);

  manager.appendCompaction('第二次摘要', kept, 110_000);
  expect(
    projectCompactionHistory(manager.getBranch())
      .slice(-3)
      .map(({ content }) => content),
  ).toEqual(['压缩摘要', '压缩后继续回复', '第二次摘要']);
});

it('运行中投影复用已定型轮次，结果与全量投影一致且不改动实时工具步骤', () => {
  const reply = (timestamp: number, text: string) => ({
    role: 'assistant',
    content: [{ type: 'text', text }],
    stopReason: 'stop',
    timestamp,
  });
  const messages = [
    { role: 'user', content: '第一问', timestamp: 1 },
    reply(2, '第一答'),
    { role: 'user', content: '第二问', timestamp: 3 },
    {
      role: 'assistant',
      content: [{ type: 'toolCall', id: 't1', name: 'read', arguments: { path: 'a' } }],
      stopReason: 'toolUse',
      timestamp: 4,
    },
    {
      role: 'toolResult',
      toolCallId: 't1',
      toolName: 'read',
      content: [{ type: 'text', text: '内容' }],
      isError: false,
      timestamp: 5,
    },
  ] as unknown as AgentMessage[];
  const pending = new Map([['t1', { id: 't1', name: 'read', input: { path: 'a' }, startedAt: 4 }]]);
  const thinking = new Map();
  const first = projectLiveMessages('live-test', messages, pending, thinking);
  expect(first).toEqual(projectMessages(messages, pending, true, undefined, thinking));
  expect(pending.get('t1')).not.toHaveProperty('output');
  const next = [...messages, reply(6, '第二答')] as AgentMessage[];
  const second = projectLiveMessages('live-test', next, pending, thinking);
  expect(second).toEqual(projectMessages(next, pending, true, undefined, thinking));
  expect(second.slice(0, 2)).toEqual(first.slice(0, 2));
  expect(second[0]).toBe(first[0]);
  expect(second[1]).toBe(first[1]);
});
