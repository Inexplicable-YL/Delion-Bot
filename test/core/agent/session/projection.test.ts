import type { AgentMessage } from '@earendil-works/pi-agent-core';
import type { SessionEntry } from '@earendil-works/pi-coding-agent';
import { expect, it } from 'vitest';
import {
  projectMessages,
  thinkingKey,
  thinkingTimes,
  THINKING_TIME,
} from '../../../../src/core/agent/session/projection';

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
