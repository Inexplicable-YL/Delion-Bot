import { beforeEach, expect, it, vi } from 'vitest';
import type { TodoState } from '../../../../../src/modules/todo/contract';
import { getTodoState, removeTodo, saveTodo } from '../../../../../src/modules/todo/main/store';
import { todoDomain } from '../../../../../src/modules/todo/main/agent';

vi.mock('../../../../../src/modules/todo/main/store', () => ({
  getTodoState: vi.fn(),
  removeTodo: vi.fn(),
  saveTodo: vi.fn(),
}));

beforeEach(() => {
  vi.resetAllMocks();
  const items: TodoState['items'] = [
    {
      id: 'draft',
      title: '写报告',
      notes: '准备图表',
      dueAt: null,
      status: 'pending',
      createdAt: '2026-09-01T00:00:00Z',
    },
    {
      id: 'sent',
      title: '发送报告',
      notes: '发送图表',
      dueAt: null,
      status: 'completed',
      createdAt: '2026-09-01T00:00:00Z',
    },
  ];
  vi.mocked(getTodoState).mockReturnValue({ items });
});

it('按标题、备注和完成状态筛选，返回筛选后的分页总数', () => {
  expect(
    todoDomain.commands.query_todos.execute({ query: '图表', completed: false, limit: 1 }),
  ).toMatchObject({
    items: [{ id: 'draft' }],
    total: 1,
    coverage: { scope: 'personal_todos', complete: true },
  });
});

it('更新或删除不存在的待办时返回 NOT_FOUND', () => {
  vi.mocked(saveTodo).mockImplementation(() => {
    throw new Error('待办不存在');
  });
  expect(() =>
    todoDomain.commands.save_todo.execute({
      id: '00000000-0000-4000-8000-000000000000',
      title: '报告',
    }),
  ).toThrow(expect.objectContaining({ code: 'NOT_FOUND' }));
  expect(() => todoDomain.commands.remove_todo.execute({ id: 'missing' })).toThrow(
    expect.objectContaining({ code: 'NOT_FOUND' }),
  );
  expect(removeTodo).not.toHaveBeenCalled();
});
