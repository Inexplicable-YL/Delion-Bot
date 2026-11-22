// @vitest-environment jsdom
import { act, useState, type ComponentProps } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { notifyManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { ChatMediaView, ContextUsageView } from '../../../../src/core/protocol/agent';
import { chatImageToken } from '../../../../src/core/protocol/chat-input';

vi.hoisted(() => {
  window.delionBot = {
    bridge: { invoke: async () => undefined, subscribe: () => () => {} },
  } as unknown as NonNullable<typeof window.delionBot>;
});
import { ChatComposer, cacheHitRateText } from '../../../../src/modules/chat/view/ChatComposer';
import type { ComposerEditor } from '../../../../src/modules/chat/view/ComposerEditor';
import { setChatMediaPreview } from '../../../../src/modules/chat/view/media';

vi.mock('../../../../src/modules/chat/view/ComposerEditor', () => ({
  ComposerEditor: ({
    value,
    onChange,
    onCaret,
    handleRef,
  }: ComponentProps<typeof ComposerEditor>) => {
    handleRef.current = {
      focus: () => {},
      insertAt: (pos, text) => onChange(`${value.slice(0, pos)}${text}${value.slice(pos)}`),
      replaceRange: () => {},
      selectionStart: () => value.length,
    };
    return (
      <textarea
        aria-label="发送给助手"
        onChange={(event) => {
          const next = event.target.value;
          onChange(next);
          onCaret(next, next.length);
        }}
        value={value}
      />
    );
  },
}));

let host: HTMLDivElement;
let root: Root;
let queryClient: QueryClient;

function Harness({
  contextUsage,
  busy = false,
  sidechat = false,
  hero = false,
  initialValue = '',
  initialAttachments = [],
}: {
  busy?: boolean;
  sidechat?: boolean;
  hero?: boolean;
  initialValue?: string;
  initialAttachments?: ChatMediaView[];
  contextUsage: ContextUsageView;
}) {
  const [value, setValue] = useState(initialValue);
  const [attachments, setAttachments] = useState(initialAttachments);
  return (
    <QueryClientProvider client={queryClient}>
      <ChatComposer
        attachments={attachments}
        comments={[]}
        onCommentsChange={() => {}}
        busy={busy}
        sidechat={sidechat}
        hero={hero}
        configured
        context={null}
        contextUsage={contextUsage}
        effort={null}
        effortLevels={[]}
        model="test-model"
        onAddAttachmentFile={async () => {}}
        onAddAttachmentView={() => {}}
        onChange={setValue}
        onEffortSelect={() => {}}
        onModelSelect={() => {}}
        onRemoveAttachment={(id) =>
          setAttachments((current) => current.filter((item) => item.id !== id))
        }
        onSend={() => {}}
        onStop={() => {}}
        referenceOptions={[]}
        value={value}
      />
    </QueryClientProvider>
  );
}

const usage = (patch: Partial<ContextUsageView> = {}): ContextUsageView => ({
  tokens: 12000,
  contextWindow: 200000,
  percent: 6,
  ...patch,
});

function typeText(text: string) {
  const editor = host.querySelector<HTMLTextAreaElement>('textarea')!;
  const setValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
  act(() => {
    setValue.call(editor, text);
    editor.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  notifyManager.setScheduler(queueMicrotask);
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  delete window.delionBot;
});

it('命中率文本只在拿到两个累计字段且分母大于 0 时才算数，其余留空', () => {
  expect(cacheHitRateText(usage())).toBe('—');
  expect(cacheHitRateText(usage({ inputTokens: 100 }))).toBe('—');
  expect(cacheHitRateText(usage({ cachedTokens: 100 }))).toBe('—');
  expect(cacheHitRateText(usage({ inputTokens: 0, cachedTokens: 0 }))).toBe('—');
  expect(cacheHitRateText(usage({ inputTokens: 1000, cachedTokens: 0 }))).toBe('0.0%');
  expect(cacheHitRateText(usage({ inputTokens: 1, cachedTokens: 2 }))).toBe('66.7%');
});

it('运行中输入框有内容时按钮是发送（插队），清空后变回停止；旁问运行中始终是停止', async () => {
  const button = () =>
    host.querySelector<HTMLButtonElement>(
      'button[aria-label="发送"], button[aria-label="停止执行"]',
    )!;
  await act(async () => root.render(<Harness busy contextUsage={usage()} />));
  expect(button().getAttribute('aria-label')).toBe('停止执行');
  typeText('顺便看一下 B');
  expect(button().getAttribute('aria-label')).toBe('发送');
  typeText('');
  expect(button().getAttribute('aria-label')).toBe('停止执行');

  await act(async () => root.render(<Harness busy contextUsage={usage()} sidechat />));
  typeText('顺便问一句');
  expect(button().getAttribute('aria-label')).toBe('停止执行');
});

it('图片和文件共用附件栏，清空文字后仍可发送，叉号只移除对应附件', async () => {
  const first = 'f9c8e31f-1ec6-4b27-92db-88dd7f2018b2';
  const second = 'b5b6a501-02ef-4d3f-abb4-8a4bd855b8ea';
  setChatMediaPreview(first, 'https://example.test/first.png');
  setChatMediaPreview(second, 'https://example.test/second.png');
  const initialValue = `AB${chatImageToken(first, '第一张.png')}CD${chatImageToken(second, '第二张.png')}`;
  const remove = (name: string) =>
    host.querySelector<HTMLButtonElement>(`button[aria-label="移除图片 ${name}"]`);
  const send = () => host.querySelector<HTMLButtonElement>('button[aria-label="发送"]')!;
  const file: ChatMediaView = {
    id: 'file',
    name: 'main-1.json',
    size: 407,
    kind: 'attachment',
    previewUrl: null,
  };

  await act(async () =>
    root.render(
      <Harness contextUsage={usage()} initialAttachments={[file]} initialValue={initialValue} />,
    ),
  );
  expect(host.querySelector('textarea')?.value).toBe('ABCD');
  typeText('');
  expect(send().disabled).toBe(false);
  const rail = host.querySelector('[aria-label="待发送附件"]')!;
  expect(rail.querySelectorAll('img')).toHaveLength(2);
  const removeFile = rail.querySelector<HTMLButtonElement>(
    'button[aria-label="移除附件 main-1.json"]',
  )!;
  act(() => removeFile.click());
  expect(rail.contains(removeFile)).toBe(false);
  expect(rail.querySelectorAll('img')).toHaveLength(2);

  act(() => remove('第一张.png')!.click());
  expect(remove('第一张.png')).toBeNull();
  expect(send().disabled).toBe(false);
  act(() => remove('第二张.png')!.click());
  expect(send().disabled).toBe(true);
});

it('新对话只建议可用的 Agent 操作，点击时将任务写入聊天草稿', async () => {
  const webSearchKey = ['capabilities', 'webSearchOptions'];
  const entries = [{ id: 'search-id', name: 'Search', provider: 'brave' }];
  queryClient.setQueryDefaults(['capabilities'], { staleTime: Infinity });
  queryClient.setQueryData(['capabilities', 'builtin'], [{ name: 'web_fetch', enabled: true }]);
  queryClient.setQueryData(['capabilities', 'skills'], []);
  queryClient.setQueryData(webSearchKey, { entries, selectedId: null });
  queryClient.setQueryDefaults(['connectors'], { staleTime: Infinity });
  queryClient.setQueryData(['connectors', 'configured'], true);
  queryClient.setQueryData(
    ['connectors', 'catalog'],
    [{ slug: 'gmail', name: 'Gmail', logo: 'https://example.test/gmail.png' }],
  );
  queryClient.setQueryData(
    ['connectors', 'accounts'],
    [
      { id: 'gmail', status: 'ACTIVE', toolkit: { slug: 'gmail' } },
      { id: 'calendar', status: 'INITIATED', toolkit: { slug: 'googlecalendar' } },
    ],
  );
  const action = (label: string) =>
    [...host.querySelectorAll('button')].find((button) => button.textContent === label);

  await act(async () => root.render(<Harness contextUsage={usage()} hero />));
  expect(action('总结网页')).toBeDefined();
  expect(action('查看 Gmail 未读邮件')).toBeDefined();
  expect(action('查看今日日程')).toBeUndefined();
  expect(action('搜索网络')).toBeUndefined();

  await act(async () =>
    queryClient.setQueryData(webSearchKey, { entries, selectedId: 'search-id' }),
  );
  act(() => action('搜索网络')!.click());
  expect(host.querySelector('textarea')?.value).toBe('请联网搜索：');
  typeText('');

  await act(async () =>
    queryClient.setQueryData(
      ['connectors', 'accounts'],
      ['gmail', 'googlecalendar', 'slack', 'notion'].map((slug) => ({
        id: slug,
        status: 'ACTIVE',
        toolkit: { slug },
      })),
    ),
  );
  expect(
    ['查看 Gmail 未读邮件', '查看今日日程', '搜索 Slack 消息', '查找 Notion 页面'].filter(action),
  ).toHaveLength(3);
  expect(action('搜索网络')).toBeUndefined();
});
