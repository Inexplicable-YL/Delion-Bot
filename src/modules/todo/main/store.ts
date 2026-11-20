import { randomUUID } from 'node:crypto';
import { emit, hostPorts } from '../../../core/ports';
import {
  todoContract,
  todoSaveSchema,
  type TodoItem,
  type TodoSaveInput,
  type TodoState,
} from '../contract';

export function getTodoState(): TodoState {
  const rows = hostPorts().database().prepare('SELECT data FROM todo_items').all() as {
    data: string;
  }[];
  return {
    items: rows
      .map((row) => JSON.parse(row.data) as TodoItem)
      .sort(
        (a, b) => (a.dueAt ?? 'z').localeCompare(b.dueAt ?? 'z') || a.title.localeCompare(b.title),
      ),
  };
}

function publishTodoState(): TodoState {
  const state = getTodoState();
  emit(todoContract, 'state', state);
  return state;
}

export function saveTodo(input: TodoSaveInput): TodoState {
  const value = todoSaveSchema.parse(input);
  const existing = value.id
    ? (hostPorts().database().prepare('SELECT data FROM todo_items WHERE id = ?').get(value.id) as
        { data: string } | undefined)
    : undefined;
  if (value.id && !existing) throw new Error('待办不存在');
  const old = existing ? (JSON.parse(existing.data) as TodoItem) : undefined;
  const now = new Date().toISOString();
  const item: TodoItem = {
    id: value.id ?? randomUUID(),
    title: value.title,
    notes: value.notes ?? old?.notes ?? '',
    dueAt: value.dueAt === undefined ? (old?.dueAt ?? null) : value.dueAt,
    status:
      value.completed === undefined
        ? (old?.status ?? 'pending')
        : value.completed
          ? 'completed'
          : 'pending',
    color: value.color ?? old?.color,
    createdAt: old?.createdAt ?? now,
  };
  hostPorts()
    .database()
    .prepare(
      'INSERT INTO todo_items(id, data) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET data=excluded.data',
    )
    .run(item.id, JSON.stringify(item));
  return publishTodoState();
}

export function removeTodo(id: string): TodoState {
  hostPorts().database().prepare('DELETE FROM todo_items WHERE id = ?').run(id);
  return publishTodoState();
}
