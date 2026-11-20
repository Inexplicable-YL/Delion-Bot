// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TodoItem, TodoSaveInput, TodoState } from '../../../../src/modules/todo/contract';
import { useTodoPreferences } from '../../../../src/modules/todo/view/preferences';

// 契约客户端在模块加载时取 bridge，须先于导入视图装好。
const api = vi.hoisted(() => {
  const handlers: Record<string, (input: unknown) => Promise<unknown>> = {};
  window.delionBot = {
    bridge: {
      invoke: (channel: string, input: unknown) => handlers[channel.slice('todo:'.length)]!(input),
      subscribe: () => () => {},
    },
  } as unknown as NonNullable<typeof window.delionBot>;
  return handlers;
});
import { TodoView } from '../../../../src/modules/todo/view/TodoView';

const dueAt = new Date(2026, 9, 21, 23, 59).toISOString();
const items: TodoItem[] = [
  {
    id: 'c14bd570-dd61-4d9f-a28e-a2bbaf7c45aa',
    title: '有截止日期待办',
    notes: '',
    dueAt,
    status: 'pending',
    createdAt: dueAt,
  },
];
const state: TodoState = {
  items,
};

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('matchMedia', () => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
  }));
  localStorage.clear();
  useTodoPreferences.setState({ showCompleted: true });
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  for (const name of ['state', 'save', 'remove']) api[name] = vi.fn(async () => state);
});

const view = () => (
  <QueryClientProvider client={new QueryClient()}>
    <TodoView target={{}} />
  </QueryClientProvider>
);

async function renderView() {
  await act(async () => root.render(view()));
  await vi.waitFor(() => expect(host.textContent).not.toContain('正在加载'));
}

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('TODO 视图', () => {
  it('新建待办保存时不会默认成已经过去的截止时间', async () => {
    const save = vi.fn(async (_input: unknown) => state);
    api.save = save;
    await renderView();
    await act(async () => {
      [...host.querySelectorAll('button')]
        .find((button) => button.textContent?.includes('新建待办'))!
        .click();
    });

    const composer = document.body.querySelector('[role="dialog"][aria-labelledby]')!;
    const titleInput = composer.querySelector<HTMLInputElement>('input[aria-label="标题"]')!;
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    await act(async () => {
      setValue.call(titleInput, '测试待办');
      titleInput.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => {
      [...composer.querySelectorAll('button')]
        .find((button) => button.textContent?.trim() === '保存')!
        .click();
    });

    expect(save).toHaveBeenCalled();
    const saved = save.mock.calls[0]![0] as TodoSaveInput;
    expect(saved.dueAt == null || Date.parse(saved.dueAt) >= Date.now()).toBe(true);
  });
});
