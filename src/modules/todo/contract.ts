import { z } from 'zod';
import { defineContract } from '../../core/protocol/contract';

export const calendarEventColors = [
  'rose',
  'peach',
  'sand',
  'sage',
  'teal',
  'blue',
  'lilac',
  'slate',
] as const;

export type CalendarEventColor = (typeof calendarEventColors)[number];

export type TodoStatus = 'pending' | 'completed';

export interface TodoItem {
  id: string;
  title: string;
  notes: string;
  dueAt: string | null;
  status: TodoStatus;
  createdAt: string;
  color?: CalendarEventColor;
}
export interface TodoState {
  items: TodoItem[];
}

export const todoSaveSchema = z
  .object({
    id: z.string().uuid().optional(),
    title: z.string().trim().min(1).max(200),
    notes: z.string().max(10000).optional(),
    dueAt: z.string().datetime().nullable().optional(),
    completed: z.boolean().optional(),
    color: z.enum(calendarEventColors).optional(),
  })
  .strict();
export type TodoSaveInput = z.input<typeof todoSaveSchema>;

const todoId = z.string().min(1).max(512);
const state = z.custom<TodoState>();

export const todoContract = defineContract(
  'todo',
  {
    state: { input: z.undefined(), output: state },
    save: { input: todoSaveSchema, output: state },
    remove: { input: todoId, output: state },
  },
  { state },
);

export const todoStatusLabels: Record<TodoStatus, string> = {
  pending: '未完成',
  completed: '已完成',
};

export function todoCompleted(status: TodoStatus): boolean {
  return status === 'completed';
}

declare module '../../app/module' {
  interface NavTargets {
    todo: { todoId?: string };
  }
}
