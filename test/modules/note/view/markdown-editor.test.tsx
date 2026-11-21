// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EditorView } from '@codemirror/view';
import { MarkdownEditor, lineSeparatorOf } from '../../../../src/modules/note/view/MarkdownEditor';

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

describe('lineSeparatorOf', () => {
  it('按第一个换行判定', () => {
    expect(lineSeparatorOf('a\r\nb\nc')).toBe('\r\n');
    expect(lineSeparatorOf('a\nb\r\nc')).toBe('\n');
    expect(lineSeparatorOf('单行')).toBe('\n');
    expect(lineSeparatorOf('\nb')).toBe('\n');
  });
});

describe('MarkdownEditor', () => {
  it.each([
    ['CRLF', '第一行\r\n第二行\r\n', '第一行\r\n第二行!\r\n'],
    ['LF', '第一行\n第二行\n', '第一行\n第二行!\n'],
  ])('%s 文件编辑一处后回传的正文只差这一处', async (_label, original, expected) => {
    const onChange = vi.fn();
    await act(async () =>
      root.render(
        <MarkdownEditor
          value={original}
          filename="a.txt"
          onChange={onChange}
          onSave={() => {}}
          onScroll={() => {}}
        />,
      ),
    );
    const view = EditorView.findFromDOM(container.querySelector('.cm-editor') as HTMLElement)!;
    expect(view.state.sliceDoc()).toBe(original);
    const at = view.state.doc.line(2).to;
    await act(async () => view.dispatch({ changes: { from: at, insert: '!' } }));
    expect(onChange).toHaveBeenLastCalledWith(expected);
  });
});
