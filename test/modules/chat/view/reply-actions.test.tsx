// @vitest-environment jsdom
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { WorkspaceChat } from '../../../../src/core/protocol/agent';
import { ChatThread } from '../../../../src/modules/chat/view/ChatThread';

vi.mock('../../../../src/modules/chat/view/Markdown', () => ({
  ChatMarkdown: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));
vi.mock('../../../../src/ui/use-media-query', () => ({ useMediaQuery: () => true }));

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  );
  vi.stubGlobal('matchMedia', () => ({ matches: true }));
  HTMLElement.prototype.scrollTo = () => {};
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  delete (HTMLElement.prototype as Partial<HTMLElement>).scrollTo;
  vi.unstubAllGlobals();
});

const chat: WorkspaceChat = {
  sessionId: 'test-session',
  projectId: null,
  cwd: null,
  running: false,
  configured: true,
  providerId: null,
  providerName: null,
  model: 'test-model',
  modelUnavailable: false,
  effortLevels: [],
  effort: null,
  messages: [
    { role: 'user', content: '问题' },
    { role: 'assistant', content: '回答', entryId: 'entry-1', startedAt: 1, finishedAt: 2 },
  ],
};

it('重试与创建对话分支收在回复的更多操作菜单里', async () => {
  const onFork = vi.fn();
  const onEditLast = vi.fn();
  await act(async () =>
    root.render(<ChatThread chat={chat} onEditLast={onEditLast} onFork={onFork} />),
  );
  const open = () =>
    act(async () =>
      host
        .querySelector('[aria-label="更多操作"]')!
        .dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })),
    );
  const item = (label: string) =>
    [...document.querySelectorAll<HTMLElement>('[role=menuitem]')].find(
      (element) => element.textContent === label,
    )!;

  await open();
  await act(async () => item('创建对话分支').click());
  expect(onFork).toHaveBeenCalledWith('entry-1');

  await open();
  await act(async () => item('重试').click());
  expect(onEditLast).toHaveBeenCalledWith('问题', undefined);
});
