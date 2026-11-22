// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ChatMarkdown } from '../../../../src/modules/chat/view/Markdown';
import { ReplyImageContext } from '../../../../src/modules/chat/view/ReplyImageContext';

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
      <ReplyImageContext.Provider value={{ sessionId, cwd: '/project' }}>
        <ChatMarkdown replyImages>{markdown}</ChatMarkdown>
      </ReplyImageContext.Provider>,
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
