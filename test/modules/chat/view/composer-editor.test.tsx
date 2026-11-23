// @vitest-environment jsdom
import { act, createRef, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { deleteCharBackward } from '@codemirror/commands';
import { EditorView } from '@codemirror/view';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  ComposerEditor,
  type ComposerEditorHandle,
} from '../../../../src/modules/chat/view/ComposerEditor';

let host: HTMLDivElement;
let root: Root;

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
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

function Harness({ initial, onChange }: { initial: string; onChange: (text: string) => void }) {
  const [value, setValue] = useState(initial);
  return (
    <ComposerEditor
      handleRef={createRef<ComposerEditorHandle>()}
      menu={{ onKey: () => false }}
      onCaret={() => {}}
      onChange={(text) => {
        setValue(text);
        onChange(text);
      }}
      onFiles={() => {}}
      onSend={() => {}}
      placeholderText=""
      referenceOptions={[{ key: 'src/app.ts', title: 'src/app.ts' }]}
      value={value}
    />
  );
}

async function renderEditor(value: string, onChange = vi.fn()) {
  await act(async () => root.render(<Harness initial={value} onChange={onChange} />));
  return EditorView.findFromDOM(host.querySelector<HTMLElement>('.cm-editor')!)!;
}

it('退格一次删除整个 @ 文件引用', async () => {
  const onChange = vi.fn();
  const view = await renderEditor('看 @src/app.ts', onChange);
  act(() => {
    view.dispatch({ selection: { anchor: view.state.doc.length } });
    deleteCharBackward(view);
  });
  expect(view.state.doc.toString()).toBe('看 ');
  expect(onChange).toHaveBeenLastCalledWith('看 ');
});

it('输入的网页链接显示为带图标的引用，且可以逐字删除', async () => {
  const view = await renderEditor('打开 https://example.com/a，然后');
  expect(host.querySelector('.cm-ref-name')?.textContent).toBe('https://example.com/a');
  expect(host.querySelectorAll('.delion-ref-icon')).toHaveLength(1);
  act(() => {
    view.dispatch({ selection: { anchor: '打开 https://example.com/a'.length } });
    deleteCharBackward(view);
  });
  expect(view.state.doc.toString()).toBe('打开 https://example.com/，然后');
});

it('Markdown 链接只显示文本，代码里的网址不显示为链接', async () => {
  await renderEditor('[文档](https://x.com) `https://y.com`');
  expect([...host.querySelectorAll('.cm-ref-name')].map((node) => node.textContent)).toEqual([
    '文档',
  ]);
  expect(host.querySelector('.cm-content')?.textContent).not.toContain('https://x.com');
});

const menuButton = (label: string) =>
  [...document.body.querySelectorAll<HTMLButtonElement>('button')].find(
    (button) => button.textContent === label,
  )!;

async function openLinkMenu(view: EditorView, pos: number) {
  act(() => view.dispatch({ selection: { anchor: pos } }));
  await act(async () =>
    host
      .querySelector('.cm-web-link:not(.delion-ref-icon)')!
      .dispatchEvent(new MouseEvent('click', { bubbles: true })),
  );
}

async function submitField(label: string, value: string) {
  const field = document.body.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(field, value);
    field.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await act(async () => field.form!.requestSubmit());
}

it('单击链接弹出操作条，可以打开链接', async () => {
  const open = vi.spyOn(window, 'open').mockReturnValue(null);
  const view = await renderEditor('看 https://example.com/a 吧');
  await openLinkMenu(view, 5);
  await act(async () => menuButton('打开链接').click());
  expect(open).toHaveBeenCalledWith('https://example.com/a', '_blank', 'noreferrer');
  expect(document.body.textContent).not.toContain('编辑文本');
});

it('编辑文本把网址变成带文本的链接，编辑链接只替换地址', async () => {
  const view = await renderEditor('看 https://example.com/a 吧');
  await openLinkMenu(view, 5);
  await act(async () => menuButton('编辑文本').click());
  await submitField('链接文本', '示例');
  expect(view.state.doc.toString()).toBe('看 [示例](https://example.com/a) 吧');

  await openLinkMenu(view, 4);
  await act(async () => menuButton('编辑链接').click());
  await submitField('链接地址', 'https://example.com/b');
  expect(view.state.doc.toString()).toBe('看 [示例](https://example.com/b) 吧');
});
