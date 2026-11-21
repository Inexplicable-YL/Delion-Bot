import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve as resolveLocal } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ root: '' }));
vi.mock('electron', () => ({ app: { getPath: () => state.root, isPackaged: false } }));

import { openPiSession } from '../../../../src/core/agent/pi';
import { remoteTools } from '../../../../src/core/agent/remote-tools';
import { remoteBackend } from '../../../../src/core/remote/operations';
import type { StoredLlmProvider } from '../../../../src/core/agent/llm-config';

const remotePath = '/root/proj';
const provider: StoredLlmProvider = {
  id: '11111111-1111-4111-8111-111111111111',
  name: '测试',
  baseUrl: 'https://example.invalid/v1',
  apiKey: 'test',
  models: ['test-model'],
  piProvider: null,
  enabled: true,
};

beforeEach(() => {
  state.root = mkdtempSync(join(tmpdir(), 'delion-remote-session-'));
});
afterEach(() => rmSync(state.root, { force: true, recursive: true }));

describe('远程会话接线', () => {
  it('cwd 用远端路径建会话，七个工具是 Delion Bot 的远程版本且不在本地建目录', async () => {
    const session = await openPiSession({
      cwd: remotePath,
      selection: { provider, model: 'test-model', effort: null },
      appendSystemPrompt: ['远端项目 /root/proj'],
      customTools: await remoteTools(
        remotePath,
        remoteBackend({ host: 'root@127.0.0.1', keyPath: null }),
      ),
      shellPath: 'C:\\Program Files\\Git\\bin\\bash.exe',
      skillPaths: [],
      globalSkillDirs: [],
      disabledSkills: new Set(),
      disabledTools: [],
    });
    const tools = session.getAllTools();
    for (const name of ['read', 'write', 'edit', 'bash', 'ls', 'find', 'grep']) {
      expect(tools.find((tool) => tool.name === name)?.sourceInfo.source, name).toBe('sdk');
    }
    expect(session.getActiveToolNames()).toEqual(
      expect.arrayContaining(['read', 'write', 'edit', 'bash', 'ls', 'find', 'grep']),
    );
    expect(existsSync(resolveLocal(remotePath))).toBe(false);
    await session.dispose();
  }, 60_000);
});
