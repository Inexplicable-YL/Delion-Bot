// @vitest-environment jsdom
import { act } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ChatMarkdown } from '../../../../src/modules/chat/view/Markdown';
import { ChatTabSourceProvider } from '../../../../src/modules/chat/view/ChatSource';
import { ReplyImageContext } from '../../../../src/modules/chat/view/ReplyImageContext';
import { sourceReferences } from '../../../../src/modules/chat/view/reference-tokens';
import { chatClient } from '../../../../src/modules/chat/view/client';
import { ZoomableImage } from '../../../../src/ui/ZoomableImage';

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
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it('static 模式保留未闭合尖括号之后的正文', async () => {
  await act(async () => {
    root.render(<ChatMarkdown>{'n<m 后面的内容'}</ChatMarkdown>);
  });

  expect(host.textContent).toContain('后面的内容');

  await act(async () => {
    root.render(<ChatMarkdown>{'a <b dsadas'}</ChatMarkdown>);
  });

  expect(host.textContent).toBe('a <b dsadas');
});

const sessionId = '6f1c2b1e-8a3d-4c1f-9b2e-1d2c3b4a5f60';
const localSrc = (path: string) =>
  `delion-resource://reply-image/${sessionId}?path=${encodeURIComponent(path)}`;

async function renderReply(markdown: string) {
  await act(async () => {
    root.render(
      <QueryClientProvider client={new QueryClient()}>
        <ReplyImageContext.Provider value={{ sessionId, cwd: '/project' }}>
          <ChatMarkdown replyImages>{markdown}</ChatMarkdown>
        </ReplyImageContext.Provider>
      </QueryClientProvider>,
    );
  });
  return [...host.querySelectorAll('img')].map((image) => image.getAttribute('src'));
}

it('回复里被文字隔开的图片各自单张显示在原文位置', async () => {
  const sources = await renderReply(
    '前文 ![图表](out/my%20chart.png) 中间 ![网图](https://example.com/a.png) 后文',
  );

  expect(sources).toEqual([localSrc('out/my chart.png'), 'https://example.com/a.png']);
  expect(host.querySelector('p')!.textContent).toMatch(/^前文\s+中间\s+后文\s*$/);
  expect(host.querySelectorAll('[aria-label^="放大查看"]')).toHaveLength(2);
});

it('loads reply thumbnails instead of originals in the message', async () => {
  vi.stubGlobal('delionBot', {});
  const url = 'data:image/png;base64,thumbnail';
  const preview = vi
    .spyOn(chatClient, 'imagePreview')
    .mockResolvedValue({ url, width: 4000, height: 2000 });
  try {
    await renderReply('![图表](chart.png)');
    await vi.waitFor(async () => {
      await act(async () => {});
      expect(host.querySelector('img')?.getAttribute('src')).toBe(url);
    });
    expect(preview).toHaveBeenCalledExactlyOnceWith({
      sessionId,
      image: { path: 'chart.png', alt: '图表' },
    });
  } finally {
    preview.mockRestore();
  }
});

it('keeps the thumbnail visible until the original image has decoded', async () => {
  const url = 'data:image/png;base64,thumbnail';
  const original = localSrc('chart.png');
  await act(async () =>
    root.render(
      <ZoomableImage alt="图表" preview={{ url, width: 4000, height: 2000 }} src={original} />,
    ),
  );
  const thumbnail = host.querySelector('img')!;
  expect(thumbnail.getAttribute('src')).toBe(url);

  await act(async () => thumbnail.dispatchEvent(new Event('load')));
  const full = host.querySelectorAll('img')[1]!;
  expect(full.getAttribute('src')).toBe(original);
  expect(full.getAttribute('aria-hidden')).toBe('true');

  let finishDecode!: () => void;
  full.decode = () =>
    new Promise((resolve) => {
      finishDecode = resolve;
    });
  await act(async () => full.dispatchEvent(new Event('load')));
  expect(host.querySelector('img')).toBe(thumbnail);
  await act(async () => finishDecode());
  expect(host.querySelectorAll('img')).toHaveLength(1);
  expect(host.querySelector('img')).toBe(full);
  expect(full.hasAttribute('aria-hidden')).toBe(false);
});

it('相邻行的多张图片合成一组', async () => {
  const sources = await renderReply('说明\n\n![一](a.png)\n![二](b.png)\n![三](c.png)');

  expect(sources).toEqual([localSrc('a.png'), localSrc('b.png'), localSrc('c.png')]);
  expect(host.querySelectorAll('p > span > button')).toHaveLength(3);
});

it('含空格的 Windows 图片路径也按图片显示，代码里的不处理', async () => {
  const path = String.raw`C:\Users\me\Documents\Delion Bot\tmp\image2.png`;
  const sources = await renderReply(`图 1\n\n![状态机](${path}) 结束\n\n\`![代码](a b.png)\``);

  expect(sources).toEqual([localSrc(path)]);
  expect(host.textContent).toContain('![代码](a b.png)');
});

it('用户消息里的 @ 文件引用渲染为可点击的链接并打开源文件', async () => {
  const onOpen = vi.fn();
  const key = '/project/chat/images/slope.jpg';
  await act(async () => {
    root.render(
      <ChatMarkdown references={{ options: sourceReferences([{ key }]), onOpen }}>
        {'@images/slope.jpg 这是什么'}
      </ChatMarkdown>,
    );
  });

  const link = host.querySelector<HTMLElement>('[role=button]');
  expect(link?.textContent).toBe('slope.jpg');
  await act(async () => link?.click());
  expect(onOpen).toHaveBeenCalledWith(key);
});

it('回复里指向本地文件的链接渲染为文件引用，网页链接仍经过外链确认', async () => {
  const onOpen = vi.fn();
  await act(async () => {
    root.render(
      <ChatMarkdown references={{ onOpen }}>
        {'见 [winter.py](<scripts/winter demo/winter.py>) 与 [文档](https://example.com)'}
      </ChatMarkdown>,
    );
  });

  const file = host.querySelector<HTMLElement>('[role=button]');
  expect(file?.textContent).toBe('winter.py');
  const web = host.querySelector<HTMLButtonElement>('[data-streamdown=link]');
  expect(web?.textContent).toBe('文档');
  expect(web?.querySelector('svg')).not.toBeNull();
  await act(async () => file?.click());
  expect(onOpen).toHaveBeenCalledWith('scripts/winter demo/winter.py');

  await act(async () => web?.click());
  expect(document.body.textContent).toContain('打开外部链接？');
  expect(document.body.textContent).toContain('https://example.com');
});

it('单击目录引用会等待路径类型确认，然后打开系统文件管理器', async () => {
  const onOpen = vi.fn();
  let identify!: (info: { path: string; directory: boolean; workspaceFolder: boolean }) => void;
  vi.spyOn(chatClient, 'referenceFileInfo').mockImplementation(
    () =>
      new Promise((resolve) => {
        identify = resolve;
      }),
  );
  const openDirectory = vi.spyOn(chatClient, 'openReferenceDirectory').mockResolvedValue(undefined);
  await act(async () =>
    root.render(
      <QueryClientProvider client={new QueryClient()}>
        <ChatMarkdown references={{ onOpen, fileMenu: { sessionId, remote: false } }}>
          {'[目录](src/v2.1)'}
        </ChatMarkdown>
      </QueryClientProvider>,
    ),
  );
  await act(async () => host.querySelector<HTMLElement>('[role=button]')!.click());
  expect(openDirectory).not.toHaveBeenCalled();
  await act(async () =>
    identify({ path: '/project/src/v2.1', directory: true, workspaceFolder: false }),
  );
  expect(openDirectory).toHaveBeenCalledWith({ sessionId, path: 'src/v2.1' });
  expect(onOpen).not.toHaveBeenCalled();
});

it('opens a workspace folder reference in the library instead of the file manager', async () => {
  const path = '/storage/workspace/Report bundle';
  const revealWorkspaceFolder = vi.fn().mockResolvedValue(undefined);
  const openDirectory = vi.spyOn(chatClient, 'openReferenceDirectory').mockResolvedValue(undefined);
  vi.spyOn(chatClient, 'referenceFileInfo').mockResolvedValue({
    path,
    directory: true,
    workspaceFolder: true,
  });
  await act(async () =>
    root.render(
      <QueryClientProvider client={new QueryClient()}>
        <ChatTabSourceProvider
          source={{
            navigate: () => false,
            workbench: { open: vi.fn(), openDocument: vi.fn(), close: vi.fn() },
            opensLink: () => false,
            revealWorkspaceFolder,
          }}
        >
          <ChatMarkdown references={{ onOpen: vi.fn(), fileMenu: { sessionId, remote: false } }}>
            {`[Report bundle](<${path}>)`}
          </ChatMarkdown>
        </ChatTabSourceProvider>
      </QueryClientProvider>,
    ),
  );
  await act(async () => host.querySelector<HTMLElement>('[role=button]')!.click());
  expect(revealWorkspaceFolder).toHaveBeenCalledWith(path, sessionId);
  expect(openDirectory).not.toHaveBeenCalled();
});

it.each([true, false])('文件引用菜单根据 VS Code 可用性 %s 显示并执行操作', async (available) => {
  const queryClient = new QueryClient();
  const path = 'scripts/example.ts';
  const file = { sessionId, path };
  const writeText = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
  const detect = vi.spyOn(chatClient, 'hasVsCode').mockResolvedValue(available);
  vi.spyOn(chatClient, 'referenceFileInfo').mockResolvedValue({
    path: `/project/${path}`,
    directory: false,
    workspaceFolder: false,
  });
  vi.spyOn(chatClient, 'referenceFilePath').mockResolvedValue(`/project/${path}`);
  vi.spyOn(chatClient, 'readReferenceFile').mockResolvedValue('export {};');
  const reveal = vi.spyOn(chatClient, 'revealFile').mockResolvedValue(undefined);
  const openInVsCode = vi.spyOn(chatClient, 'openInVsCode').mockResolvedValue(undefined);
  await act(async () =>
    root.render(
      <QueryClientProvider client={queryClient}>
        <ChatMarkdown references={{ onOpen: vi.fn(), fileMenu: { sessionId, remote: false } }}>
          {`[example.ts](${path})`}
        </ChatMarkdown>
      </QueryClientProvider>,
    ),
  );
  expect(detect).not.toHaveBeenCalled();
  const menuItem = (label: string) =>
    Array.from(document.querySelectorAll<HTMLElement>('[role=menuitem]')).find(
      (item) => item.textContent === label,
    );
  const openMenu = async () => {
    const link = host.querySelector<HTMLElement>('[role=button]')!;
    await act(async () => {
      link.focus();
      link.dispatchEvent(
        new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2 }),
      );
    });
    await vi.waitFor(async () => {
      await act(async () => {});
      expect(queryClient.getQueryData(['chat', 'has-vs-code'])).toBe(available);
      expect(menuItem('复制路径')).toBeDefined();
    });
  };
  const select = async (label: string) => {
    await act(async () => menuItem(label)!.click());
    await vi.waitFor(() =>
      expect(document.activeElement).toBe(host.querySelector('[role=button]')),
    );
  };
  await openMenu();
  expect(Boolean(menuItem('在 VS Code 中打开'))).toBe(available);
  await select('复制路径');
  expect(writeText).toHaveBeenLastCalledWith(`/project/${path}`);
  await openMenu();
  await select('复制文件内容');
  expect(writeText).toHaveBeenLastCalledWith('export {};');
  await openMenu();
  await select('在资源管理器中打开');
  expect(reveal).toHaveBeenCalledWith(file);
  if (available) {
    await openMenu();
    await select('在 VS Code 中打开');
    expect(openInVsCode).toHaveBeenCalledWith(file);
  }
});

const askReply =
  '请选择：\n\n```ask\n用哪种数据库？\n- PostgreSQL | 适合复杂查询\n- SQLite\n\n需要登录吗？\n- 需要\n- 不需要\n```';

const radios = () => [...host.querySelectorAll<HTMLButtonElement>('[role=radio]')];
const button = (label: string) =>
  [...host.querySelectorAll<HTMLButtonElement>('button')].find(
    (item) => item.textContent === label,
  );

it('多个问题组在一张卡片里分页作答，跳过的问题也会随最后的发送发回', async () => {
  const onAnswer = vi.fn(async () => {});
  await act(async () => {
    root.render(<ChatMarkdown asks={{ onAnswer }}>{askReply}</ChatMarkdown>);
  });

  expect(host.querySelector('pre')).toBeNull();
  expect(host.textContent).toContain('用哪种数据库？');
  expect(host.textContent).not.toContain('需要登录吗？');
  expect(radios().map((radio) => radio.textContent)).toEqual(['APostgreSQL', 'BSQLite']);
  expect(button('返回')).toBeUndefined();
  expect(button('下一步')?.disabled).toBe(true);

  await act(async () => radios()[1]!.click());
  await act(async () => button('下一步')!.click());
  expect(host.textContent).toContain('需要登录吗？');
  expect(button('返回')).toBeDefined();
  expect(button('发送')?.disabled).toBe(true);

  await act(async () => button('返回')!.click());
  expect(radios()[1]!.getAttribute('aria-checked')).toBe('true');
  await act(async () => button('下一步')!.click());
  expect(onAnswer).not.toHaveBeenCalled();
  await act(async () => button('跳过')!.click());
  expect(onAnswer).toHaveBeenCalledWith('用哪种数据库？：SQLite\n需要登录吗？：（跳过）');
});

it('“其他”行填写内容后即可确认发送', async () => {
  const onAnswer = vi.fn(async () => {});
  await act(async () => {
    root.render(
      <ChatMarkdown asks={{ onAnswer }}>{'```ask\n用哪种？\n- 甲\n- 乙\n```'}</ChatMarkdown>,
    );
  });

  const other = host.querySelector<HTMLInputElement>('input[aria-label="其他回答"]')!;
  await act(async () => {
    other.focus();
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(other, ' 丙 ');
    other.dispatchEvent(new Event('input', { bubbles: true }));
  });
  expect(onAnswer).not.toHaveBeenCalled();
  await act(async () => button('发送')!.click());
  expect(onAnswer).toHaveBeenCalledWith('丙');
});

it('已回答的询问卡片只读，可以翻页查看每组的回答', async () => {
  await act(async () => {
    root.render(
      <ChatMarkdown asks={{ answer: '用哪种数据库？：（跳过）\n需要登录吗？：看情况' }}>
        {askReply}
      </ChatMarkdown>,
    );
  });

  expect(host.querySelector('input')).toBeNull();
  expect(button('跳过')).toBeUndefined();
  expect(radios().every((radio) => radio.disabled)).toBe(true);
  expect(host.querySelector('[aria-checked=true]')).toBeNull();
  await act(async () => button('下一步')!.click());
  expect(host.querySelector('[aria-checked=true]')?.textContent).toBe('C看情况');
  expect(button('下一步')).toBeUndefined();
});

it('未开启询问时 ask 代码块按普通代码显示', async () => {
  await act(async () => {
    root.render(<ChatMarkdown>{askReply}</ChatMarkdown>);
  });

  expect(host.querySelector('[role=radio]')).toBeNull();
});
