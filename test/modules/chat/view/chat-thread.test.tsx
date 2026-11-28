// @vitest-environment jsdom
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { WorkspaceChat } from '../../../../src/core/protocol/agent';
import { ChatThread } from '../../../../src/modules/chat/view/ChatThread';
import { commentRange } from '../../../../src/modules/chat/view/ReplyComment';

vi.mock('../../../../src/modules/chat/view/Markdown', () => ({
  ChatMarkdown: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));
vi.mock('../../../../src/ui/use-media-query', () => ({ useMediaQuery: () => true }));
vi.mock('../../../../src/modules/chat/view/TurnChangesCard', () => ({
  TurnChangesCard: ({ turnId }: { turnId: string }) => <div data-turn-card={turnId} />,
}));

let host: HTMLDivElement;
let root: Root;

const chat: WorkspaceChat = {
  sessionId: 'test-session',
  projectId: null,
  cwd: null,
  running: true,
  configured: true,
  providerId: null,
  providerName: null,
  model: 'test-model',
  modelUnavailable: false,
  effortLevels: [],
  effort: null,
  messages: [
    { role: 'user', content: '检查滚动' },
    { role: 'assistant', content: '正在回答', startedAt: 1 },
  ],
};

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  );
  vi.stubGlobal('matchMedia', () => ({ matches: true }));
  HTMLElement.prototype.scrollTo = () => {};
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  delete (HTMLElement.prototype as Partial<HTMLElement>).scrollTo;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it('本地命令和回执按时间显示为普通消息', async () => {
  await act(async () =>
    root.render(
      <ChatThread
        chat={{
          ...chat,
          running: false,
          messages: [
            {
              role: 'assistant',
              content: '上一条',
              startedAt: 1,
              parts: [{ type: 'text', text: '上一条' }],
            },
            { role: 'user', content: '继续聊天', startedAt: 4 },
          ],
        }}
        commandReplies={[
          { input: '/autocompact 300k', reply: '已设置为 300k tokens。', sentAt: 2, repliedAt: 3 },
        ]}
        onSaveNote={vi.fn()}
      />,
    ),
  );
  expect(host.querySelector('[aria-label="对话消息"]')?.textContent).toBe(
    '上一条/autocompact 300k已设置为 300k tokens。继续聊天',
  );
  expect(host.querySelectorAll('button[aria-label="复制回答"]')).toHaveLength(1);
  expect(host.querySelectorAll('button[aria-label="保存为笔记"]')).toHaveLength(1);
  const localReply = [...host.querySelectorAll('p')].find(
    (p) => p.textContent === '已设置为 300k tokens。',
  )!;
  const selection = window.getSelection()!;
  const range = document.createRange();
  range.selectNodeContents(localReply);
  selection.addRange(range);
  expect(commentRange(selection, host)).toBeNull();
  selection.removeAllRanges();
});

it('压缩分隔线位于旧回复之后，点击才显示摘要', async () => {
  await act(async () =>
    root.render(
      <ChatThread
        chat={{
          ...chat,
          running: false,
          messages: [{ role: 'assistant', content: '', compacted: true }, ...chat.messages],
        }}
        compactionHistory={[
          ...chat.messages,
          {
            role: 'assistant',
            content: '压缩后的摘要',
            compacted: true,
            entryId: 'compaction-1',
            compaction: { mode: 'manual', releasedTokens: 100_000 },
          },
        ]}
        messagesAfterCompaction={[]}
      />,
    ),
  );
  const summary = host.querySelector('summary')!;
  expect(summary.textContent).toBe('上下文已压缩 · 手动 · 100k tokens 已释放');
  expect(host.textContent?.indexOf('正在回答')).toBeLessThan(
    host.textContent!.indexOf(summary.textContent!),
  );
  expect(host.textContent).not.toContain('压缩后的摘要');
  await act(async () => summary.click());
  await vi.waitFor(() => expect(host.textContent).toContain('压缩后的摘要'));
});

it('整轮失败显示错误卡与重试，重试以原文重发', async () => {
  const onEditLast = vi.fn();
  await act(async () =>
    root.render(
      <ChatThread
        onEditLast={onEditLast}
        chat={{
          ...chat,
          running: false,
          messages: [
            chat.messages[0]!,
            {
              role: 'assistant',
              content: '本次执行中断：模型请求失败（HTTP 401）',
              interrupted: true,
              startedAt: 1,
              finishedAt: 2,
              parts: [{ type: 'text', text: '本次执行中断：模型请求失败（HTTP 401）' }],
            },
          ],
        }}
      />,
    ),
  );
  const alert = host.querySelector('[role="alert"]')!;
  expect(alert.textContent).toContain('HTTP 401');
  await act(async () => alert.querySelector('button')!.click());
  expect(onEditLast).toHaveBeenCalledWith('检查滚动', undefined);
});

it.each(['project-1', null])('插队后只显示一张改动卡片 (%s)', async (projectId) => {
  const turnId = 'turn-1';
  await act(async () =>
    root.render(
      <ChatThread
        chat={{
          ...chat,
          projectId,
          running: false,
          messages: [
            { role: 'user', content: '先做 A', turnId },
            {
              role: 'assistant',
              content: '在做 A',
              startedAt: 1,
              finishedAt: 2,
              turnId,
              parts: [{ type: 'text', text: '在做 A' }],
            },
            { role: 'user', content: '顺便做 B', turnId },
            {
              role: 'assistant',
              content: 'A 和 B 都做完了',
              startedAt: 3,
              finishedAt: 4,
              turnId,
              parts: [{ type: 'text', text: 'A 和 B 都做完了' }],
            },
          ],
        }}
      />,
    ),
  );
  const cards = [...host.querySelectorAll('[data-turn-card]')];
  expect(cards).toHaveLength(1);
  expect(cards[0]!.parentElement!.textContent).toContain('A 和 B 都做完了');
});

it.each([
  ['同一轮补充要求', 'turn-1', {}],
  ['手动打断后续问', 'turn-2', { stopped: true }],
  ['进程重启后继续', 'turn-2', {}],
] as const)('%s时等最终回复完成再一起折叠推理', async (_scenario, nextTurnId, flags) => {
  const messages: WorkspaceChat['messages'] = [
    { role: 'user', content: '先检查' },
    {
      role: 'assistant',
      content: '',
      turnId: 'turn-1',
      startedAt: 1,
      finishedAt: 2_001,
      parts: [{ type: 'reasoning', text: '第一段推理' }],
      ...flags,
    },
    { role: 'user', content: '继续检查' },
    {
      role: 'assistant',
      content: '检查完毕',
      turnId: nextTurnId,
      startedAt: 60_001,
      finishedAt: 64_001,
      parts: [
        { type: 'reasoning', text: '第二段推理' },
        { type: 'text', text: '检查完毕' },
      ],
    },
  ];
  const traces = () => Array.from(host.querySelectorAll('[aria-label="对话过程"]'));
  await act(async () => root.render(<ChatThread chat={{ ...chat, messages }} />));
  expect(traces()).toHaveLength(2);
  await act(async () => traces()[0]?.querySelector('button')?.click());
  expect(traces()[0]?.textContent).toContain('第一段推理');

  await act(async () => root.render(<ChatThread chat={{ ...chat, messages, running: false }} />));
  expect(traces()).toHaveLength(1);
  const trace = traces()[0]!;
  expect(trace.querySelector('button')?.getAttribute('aria-expanded')).toBe('false');
  expect(trace.querySelector('button')?.textContent).toContain('6 秒');
  expect(trace.querySelector('[data-assistant-body]')?.textContent).toBe('检查完毕');
  await act(async () => trace.querySelector('button')?.click());
  expect(trace.querySelector('button')?.getAttribute('aria-expanded')).toBe('true');
  await act(async () =>
    Array.from(trace.querySelectorAll('button'))
      .slice(1)
      .forEach((button) => button.click()),
  );
  expect(trace.textContent).toContain('第一段推理');
  expect(trace.textContent).toContain('第二段推理');
});

it('在回复操作栏左侧显示来源，点击可打开来源链接列表', async () => {
  const url = 'https://example.com/article';
  await act(async () =>
    root.render(
      <QueryClientProvider client={new QueryClient()}>
        <ChatThread
          chat={{
            ...chat,
            running: false,
            messages: [
              {
                role: 'assistant',
                content: '回答',
                toolResults: [
                  {
                    id: 'page',
                    name: 'web_fetch',
                    input: { url },
                    output: { text: JSON.stringify({ title: 'Article', source: { url } }) },
                  },
                ],
              },
            ],
          }}
        />
      </QueryClientProvider>,
    ),
  );
  const trigger = host.querySelector('button')!;
  expect(trigger.textContent).toBe('Article');
  await act(async () => trigger.click());
  const dialog = document.querySelector('[role="dialog"]')!;
  expect(dialog.querySelector('a')?.href).toBe(url);
});
