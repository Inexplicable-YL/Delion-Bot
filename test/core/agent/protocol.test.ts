import { expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ askSession: vi.fn(async () => ({})) }));
vi.mock('../../../src/core/agent/session/run', () => ({ askSession: state.askSession }));
vi.mock('../../../src/core/agent/chat-commands', () => ({}));
vi.mock('../../../src/core/agent/media', () => ({}));
vi.mock('../../../src/core/agent/providers', () => ({}));
vi.mock('../../../src/core/agent/session/commands', () => ({}));
vi.mock('../../../src/core/agent/session/files', () => ({}));
vi.mock('../../../src/core/agent/session/store', () => ({}));
vi.mock('../../../src/core/agent/sidechat', () => ({}));
vi.mock('../../../src/core/agent/tasks', () => ({}));

import { AGENT_PROTOCOL_VERSION } from '../../../src/core/protocol/agent';
import { agentProtocol } from '../../../src/core/agent/protocol';

const sessionId = '0b9c6f6e-2a51-4d8e-9a39-5f0a4c1e7d21';
const referenced = { id: '6f1d2c3b-4a5e-4f60-8172-93a4b5c6d7e8', title: '复习计划' };

it('握手：主版本一致才放行', () => {
  expect(agentProtocol.call('handshake', { protocolVersion: AGENT_PROTOCOL_VERSION })).toEqual({
    protocolVersion: AGENT_PROTOCOL_VERSION,
  });
  expect(() =>
    agentProtocol.call('handshake', { protocolVersion: AGENT_PROTOCOL_VERSION + 1 }),
  ).toThrow('协议版本不一致');
});

it('提问：# 引用的会话随入参送达', async () => {
  await agentProtocol.call('ask', {
    sessionId,
    text: '对比一下',
    attachments: [],
    context: [],
    sessions: [referenced],
    comments: [],
  });
  expect(state.askSession).toHaveBeenCalledWith(
    sessionId,
    expect.objectContaining({ text: '对比一下', sessions: [referenced] }),
  );
});
