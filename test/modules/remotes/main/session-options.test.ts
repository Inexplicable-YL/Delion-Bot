import { statSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ToolDefinition } from '@earendil-works/pi-coding-agent';

const state = vi.hoisted(() => ({
  remote: true,
  disabled: new Set<string>(['web_fetch', 'read']),
}));

vi.mock('electron', () => ({ app: { getPath: () => 'C:\\data' } }));
vi.mock('../../../../src/core/remote/operations', () => ({ remoteBackend: () => ({}) }));
vi.mock('../../../../src/core/agent/remote-tools', () => ({
  remoteTools: async (_cwd: string, _backend: unknown): Promise<ToolDefinition[]> =>
    ['read', 'write', 'edit', 'bash', 'ls', 'find', 'grep'].map((name) => ({
      name,
      label: name,
      description: `${name}（远端）`,
      parameters: { type: 'object' } as unknown as ToolDefinition['parameters'],
      execute: async () => ({ content: [], details: undefined }),
    })),
}));
vi.mock('../../../../src/core/remote/context', () => ({
  syncRemoteContext: async () => ({
    skillPaths: [
      'C:\\data\\remote-context\\r1\\p-remote\\repo\\.agents\\skills',
      'C:\\data\\remote-context\\r1\\p-remote\\home\\.delion\\skills',
    ],
    agentsFiles: [{ path: '/root/proj/AGENTS.md', content: '暗号：菠萝' }],
  }),
}));
vi.mock('../../../../src/core/capabilities/command-server', () => ({
  COMMAND_BRIDGE: 'delion() { :; }',
  startDomainBridge: () => ({ url: 'http://127.0.0.1:1', token: 'token' }),
}));
vi.mock('../../../../src/core/capabilities/skills', () => ({
  builtinSkillsDirectory: () => 'C:\\skills',
  ensureBuiltinSkills: () => {},
  effectiveDisabledSkills: () => new Set<string>(),
  globalSkillDirectories: () => ['C:\\skills'],
  listGlobalSkills: () => [],
  readDisabledSkillPaths: () => new Set<string>(),
}));
vi.mock('../../../../src/core/capabilities/mcp', () => ({
  mcpToolDefinitions: () => [],
  executeMcpTool: vi.fn(),
}));
vi.mock('../../../../src/core/capabilities/tools', () => ({
  readDisabledTools: () => state.disabled,
}));

import { agentEnvironment } from '../../../../src/core/agent/environment';
import { hostPorts } from '../../../../src/core/ports';
import { provideTestHostPorts } from '../../../core/host-mock';

provideTestHostPorts({
  paths: { bash: () => 'C:\\Git\\bash.exe' },
  database: () =>
    ({
      prepare: (sql: string) => ({
        get: (id: string) =>
          sql.includes('FROM sessions')
            ? { id, parent_id: null, project_id: id === 'remote-chat' ? 'p-remote' : 'p-local' }
            : id?.startsWith('session-permission:')
              ? { value: 'full-confirmed' }
              : undefined,
        all: () => [],
      }),
    }) as never,
  projects: {
    find: () => ({ name: '课题', path: null }),
    local: () => [],
    remoteOf: (id) =>
      state.remote && id === 'p-remote'
        ? {
            id,
            path: '/root/proj',
            remoteId: 'r1',
            label: 'gpu',
            target: { host: 'root@10.0.0.5', keyPath: null },
          }
        : null,
  },
});

const names = (tools: ToolDefinition[]) => tools.map((tool) => tool.name).sort();

beforeEach(() => {
  state.remote = true;
  state.disabled = new Set(['web_fetch', 'read']);
});

describe('远程会话环境', () => {
  it('给七个远程工具加本机工具，且不带 delion 命令桥', async () => {
    const options = await agentEnvironment().sessionOptions('p-remote', '/root/proj', {
      sessionId: 'remote-chat',
    });
    expect(names(options.customTools)).toEqual(
      [
        'bash',
        'edit',
        'find',
        'grep',
        'ls',
        'read',
        'session_read',
        'session_search',
        'web_fetch',
        'web_search',
        'write',
      ].sort(),
    );
    expect(options.commandPrefix).toBeUndefined();
    const prompt = options.appendSystemPrompt.join('\n');
    expect(prompt).toContain('Remote project directory: /root/proj');
    expect(prompt).toContain('$HOME/.delion-bot/chat-sessions/remote-chat');
    expect(prompt).not.toContain(hostPorts().paths.storage());
    expect(prompt).not.toContain('delion help');
  });

  it('用户关掉的能力名单不会波及七个工具名', async () => {
    const options = await agentEnvironment().sessionOptions('p-remote', '/root/proj', {
      sessionId: 'remote-chat',
    });
    expect([...options.disabledTools]).toEqual(['web_fetch']);
  });

  it('远端 AGENTS.md 的内容与远端路径一起注入，本地全局上下文不丢', async () => {
    const options = await agentEnvironment().sessionOptions('p-remote', '/root/proj', {
      sessionId: 'remote-chat',
    });
    const base = [{ path: 'C:\\data\\AGENTS.md', content: '全局' }];
    expect(options.agentsFilesOverride!({ agentsFiles: base })).toEqual({
      agentsFiles: [...base, { path: '/root/proj/AGENTS.md', content: '暗号：菠萝' }],
    });
  });
});

describe('本地会话环境', () => {
  it('保留 delion 命令桥与内置工具，不给远程工具', async () => {
    state.remote = false;
    const options = await agentEnvironment().sessionOptions('p-local', 'E:\\proj', {
      sessionId: 'local-chat',
    });
    expect(names(options.customTools)).toEqual([
      'session_read',
      'session_search',
      'web_fetch',
      'web_search',
    ]);
    expect(options.commandPrefix).toContain('DELION_COMMAND_URL');
    const storage = hostPorts().paths.storage();
    const sessionDirectory = join(storage, 'chat-sessions', 'local-chat');
    const prompt = options.appendSystemPrompt.join('\n');
    expect(prompt).toContain(sessionDirectory);
    expect(prompt).toContain(join(storage, 'workspace'));
    expect(statSync(sessionDirectory).isDirectory()).toBe(true);
  });
});
