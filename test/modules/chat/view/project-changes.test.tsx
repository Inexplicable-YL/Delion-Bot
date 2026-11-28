// @vitest-environment jsdom
import { act, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { FileChangeDetail } from '../../../../src/core/protocol/agent';
import type { UncommittedChanges } from '../../../../src/core/protocol/changes';

const { api, delion } = vi.hoisted(() => {
  const api = {
    readUncommittedChanges: vi.fn<(projectId: string) => Promise<UncommittedChanges>>(),
    readUncommittedFileChange:
      vi.fn<(input: { projectId: string; path: string }) => Promise<FileChangeDetail>>(),
  };
  const delion = {
    bridge: {
      invoke: (channel: string, input: never) =>
        api[channel.slice('chat:'.length) as keyof typeof api](input),
      subscribe: () => () => {},
    },
  } as unknown as NonNullable<typeof window.delionBot>;
  window.delionBot = delion;
  return { api, delion };
});
import { ProjectChanges } from '../../../../src/modules/chat/view/review/ProjectChanges';
import { ReviewTab } from '../../../../src/modules/chat/view/review/ReviewTab';
import { reviewTabId } from '../../../../src/modules/chat/view/review/tab-id';

vi.mock('../../../../src/modules/chat/view/review/PierreDiff', () => ({
  DiffScroller: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  PatchDiffView: () => null,
}));

const projectId = '0197d5a2-7b1e-7cc2-9f3a-5e6d1c2b3a4d';

const detailOf = (path: string): FileChangeDetail => ({
  path,
  status: 'modified',
  beforeBytes: 1,
  afterBytes: 2,
  textDiff: true,
  before: '旧\n',
  after: '新\n',
  patch: `@@ -1,1 +1,1 @@\n-旧\n+${path}\n`,
  note: null,
});

function summaryFixture(overrides: Partial<UncommittedChanges> = {}): UncommittedChanges {
  return {
    available: true,
    reason: null,
    cwd: 'E:\\workspace\\Test',
    repositoryRoot: 'E:\\workspace\\Test',
    head: '812a85afe35c1c1ea9b4b2a56dd7aa4f33254f10',
    warnings: [],
    files: [
      { path: 'src/app.ts', status: 'modified', beforeBytes: 10, afterBytes: 20, textDiff: true },
      { path: 'new.py', status: 'added', beforeBytes: null, afterBytes: 5, textDiff: true },
    ],
    ...overrides,
  };
}

let host: HTMLDivElement;
let root: Root;

let queryClient: QueryClient;

const settle = () => act(async () => new Promise((resolve) => setTimeout(resolve, 0)));

const onOpen = vi.fn();

async function render() {
  await act(async () =>
    root.render(
      <QueryClientProvider client={queryClient}>
        <ProjectChanges projectId={projectId} activeTab={null} onOpen={onOpen} />
      </QueryClientProvider>,
    ),
  );
  await settle();
}

beforeEach(() => {
  api.readUncommittedChanges.mockImplementation(async () => summaryFixture());
  api.readUncommittedFileChange.mockImplementation(async ({ path }) => detailOf(path));
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  );
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  window.delionBot = delion;
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  delete window.delionBot;
  vi.clearAllMocks();
});

it('非 Git 目录不读取文件详情', async () => {
  api.readUncommittedChanges.mockResolvedValue(
    summaryFixture({ available: false, reason: 'not-git', files: [] }),
  );
  await render();
  expect(api.readUncommittedFileChange).not.toHaveBeenCalled();
});

it('点击文件才打开对应的 diff 标签，刷新列表不会打开其他标签', async () => {
  await render();
  expect(api.readUncommittedFileChange).not.toHaveBeenCalled();

  await act(async () => {
    host.querySelector<HTMLButtonElement>('[title="new.py"]')!.click();
  });
  const tabId = reviewTabId({ kind: 'uncommitted', projectId, path: 'new.py' });
  expect(onOpen).toHaveBeenCalledExactlyOnceWith(tabId);

  api.readUncommittedChanges.mockResolvedValue(
    summaryFixture({
      files: [
        { path: 'gone.log', status: 'deleted', beforeBytes: 1, afterBytes: null, textDiff: true },
      ],
    }),
  );
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="刷新改动"]')!.click());
  await settle();
  expect(host.querySelector('[title="gone.log"]')).not.toBeNull();
  expect(onOpen).toHaveBeenCalledTimes(1);

  await act(async () =>
    root.render(
      <QueryClientProvider client={queryClient}>
        <ReviewTab groupId="primary" tabId={tabId} />
      </QueryClientProvider>,
    ),
  );
  await settle();
  expect(api.readUncommittedFileChange).toHaveBeenCalledExactlyOnceWith({
    projectId,
    path: 'new.py',
  });

  await act(async () => {
    host.querySelector<HTMLButtonElement>('[aria-label="重新载入"]')!.click();
  });
  await settle();
  expect(api.readUncommittedFileChange.mock.calls).toEqual([
    [{ projectId, path: 'new.py' }],
    [{ projectId, path: 'new.py' }],
  ]);
});
