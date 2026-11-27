// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { ensureSyntaxTree } from '@codemirror/language';
import { EditorSelection, EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import {
  removeLink,
  selectionFormat,
  setBlockType,
  setLink,
  toggleInline,
} from '../../../../src/modules/note/view/markdown-format';

let view: EditorView | null = null;

afterEach(() => {
  view?.destroy();
  view = null;
});

function mount(doc: string, from: number, to: number) {
  const state = EditorState.create({
    doc,
    selection: EditorSelection.range(from, to),
    extensions: [markdown({ base: markdownLanguage })],
  });
  view = new EditorView({ state, parent: document.body });
  return view;
}

function sync(editor: EditorView) {
  ensureSyntaxTree(editor.state, editor.state.doc.length, 5000);
  return selectionFormat(editor.state);
}

describe('markdown-format', () => {
  it('粗体可以来回切换，选区始终停在文字上', () => {
    const editor = mount('一段 文字 结尾', 3, 5);
    toggleInline(editor, 'StrongEmphasis');
    expect(editor.state.sliceDoc()).toBe('一段 **文字** 结尾');
    expect(sync(editor).bold).toBe(true);
    toggleInline(editor, 'StrongEmphasis');
    expect(editor.state.sliceDoc()).toBe('一段 文字 结尾');
    expect(
      editor.state.sliceDoc(editor.state.selection.main.from, editor.state.selection.main.to),
    ).toBe('文字');
  });

  it('只取消选中部分的粗体，两侧保持粗体', () => {
    const editor = mount('**模型驱动 循环**', 4, 6);
    sync(editor);
    toggleInline(editor, 'StrongEmphasis');
    expect(editor.state.sliceDoc()).toBe('**模型**驱动 **循环**');
    const { from, to } = editor.state.selection.main;
    expect(editor.state.sliceDoc(from, to)).toBe('驱动');

    const edge = mount('**模型 驱动**', 5, 7);
    sync(edge);
    toggleInline(edge, 'StrongEmphasis');
    expect(edge.state.sliceDoc()).toBe('**模型** 驱动');
    edge.destroy();
  });

  it('引用块里转换块类型保留引用前缀', () => {
    const editor = mount('> - 条目', 0, 6);
    setBlockType(editor, 'heading2');
    expect(editor.state.sliceDoc()).toBe('> ## 条目');
  });

  it('跨行加粗按行包裹，不吞掉列表标记和首尾空白', () => {
    const editor = mount('- 甲乙 \n- 丙丁', 0, '- 甲乙 \n- 丙丁'.length);
    toggleInline(editor, 'StrongEmphasis');
    expect(editor.state.sliceDoc()).toBe('- **甲乙** \n- **丙丁**');
  });

  it('块类型转换替换原有前缀并为编号列表重新编号', () => {
    const doc = '# 标题\n- [x] 待办\n\n正文';
    const editor = mount(doc, 0, doc.length);
    expect(sync(editor).block).toBe('heading1');
    setBlockType(editor, 'ordered');
    expect(editor.state.sliceDoc()).toBe('1. 标题\n2. 待办\n\n3. 正文');
    setBlockType(editor, 'paragraph');
    expect(editor.state.sliceDoc()).toBe('标题\n待办\n\n正文');
  });

  it('添加链接后可以移除，只留下文字', () => {
    const editor = mount('看 官网 吧', 2, 4);
    setLink(editor, 'https://example.com/a b');
    expect(editor.state.sliceDoc()).toBe('看 [官网](https://example.com/a%20b) 吧');
    expect(sync(editor).link).toBe(true);
    removeLink(editor);
    expect(editor.state.sliceDoc()).toBe('看 官网 吧');
  });
});
