import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { getTodoState, removeTodo, saveTodo } from '../../../src/modules/todo/main/store';

const database = vi.hoisted(() => vi.fn());
vi.mock('../../../src/core/ports', () => ({ emit: vi.fn(), hostPorts: () => ({ database }) }));

let db: DatabaseSync;
beforeEach(() => {
  db = new DatabaseSync(':memory:');
  db.exec('CREATE TABLE todo_items (id TEXT PRIMARY KEY, data TEXT NOT NULL)');
  database.mockReturnValue(db);
});
afterEach(() => db.close());

it('保留待办的截止时间与颜色，支持编辑、完成、重开和删除', () => {
  const dueAt = '2026-09-22T10:00:00.000Z';
  const [item] = saveTodo({ title: '准备报告', dueAt, color: 'rose' }).items;
  saveTodo({ id: item!.id, title: '准备报告', completed: true });
  expect(getTodoState().items[0]).toMatchObject({ dueAt, color: 'rose', status: 'completed' });
  saveTodo({ id: item!.id, title: '报告', notes: '补图', completed: false, dueAt: null });
  expect(getTodoState().items[0]).toMatchObject({
    title: '报告',
    notes: '补图',
    status: 'pending',
    dueAt: null,
  });
  removeTodo(item!.id);
  expect(getTodoState().items).toEqual([]);
});
