// 全局搜索对着 database.ts 建出来的真实表跑：影子 schema 曾经凭空补过列，让引用不存在的列也能全绿。
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ root: '' }));
vi.mock('electron', () => ({
  app: { getPath: () => state.root, isPackaged: false, getAppPath: () => process.cwd() },
  ipcMain: { handle: vi.fn() },
}));
vi.mock('../todo', () => ({ getTodoState: () => ({ items: [] }) }));

import { closeDatabase, getDatabase } from '../../../src/app/main/database';
import type { SearchGroup } from '../../../src/modules/search/contract';
import { searchModule } from '../../../src/modules/search';
import { workspaceModule } from '../../../src/modules/workspace';
import { provideTestHostPorts } from '../../core/host-mock';

const timestamp = '2026-09-16T12:00:00.000Z';
const run = (sql: string, ...values: unknown[]) =>
  getDatabase()
    .prepare(sql)
    .run(...values);
const querySearch = (query: string) => searchModule.ipc?.call('query', query) as SearchGroup[];
const hitsOf = (query: string, group: string) =>
  querySearch(query).find((item) => item.id === group)?.hits ?? [];

beforeAll(() => {
  state.root = mkdtempSync(join(tmpdir(), 'delion-search-'));
  provideTestHostPorts({ database: getDatabase });
  workspaceModule.register?.();
});
afterAll(() => {
  closeDatabase();
  rmSync(state.root, { recursive: true, force: true });
});
beforeEach(() => {
  run('DELETE FROM sessions');
  run("DELETE FROM workspace_entries WHERE kind='project'");
});

describe('global search', () => {
  it('按标题搜到顶层会话并带上项目身份，子 Agent 会话不进搜索', () => {
    run(
      "INSERT INTO workspace_entries (id, name, kind, updated_at) VALUES ('p1', '毕业设计', 'project', ?)",
      timestamp,
    );
    const insertSession = (id: string, projectId: string | null, parentId: string | null) =>
      run(
        'INSERT INTO sessions (id, project_id, file, title, parent_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        id,
        projectId,
        `${id}.jsonl`,
        `资料讨论 ${id}`,
        parentId,
        timestamp,
        timestamp,
      );
    insertSession('in-project', 'p1', null);
    insertSession('home', null, null);
    insertSession('child', 'p1', 'in-project');

    expect(hitsOf('资料讨论', 'chat')).toEqual([
      expect.objectContaining({
        id: 'in-project',
        subtitle: '毕业设计',
        target: { page: 'chat', projectId: 'p1', sessionId: 'in-project' },
      }),
      expect.objectContaining({ id: 'home', subtitle: '首页' }),
    ]);
    expect(hitsOf('', 'chat').map((hit) => hit.id)).not.toContain('child');
  });
});
