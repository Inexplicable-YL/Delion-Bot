import type { AgentMessage } from '@earendil-works/pi-agent-core';
import type { SessionEntry } from '@earendil-works/pi-coding-agent';
import { expect, it } from 'vitest';
import {
  COMPACTION_DETAILS,
  projectAfterCompaction,
  projectCompactionHistory,
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
