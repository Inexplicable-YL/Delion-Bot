import { syntaxTree } from '@codemirror/language';
import type { ChangeSpec, EditorState } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';

export type BlockType =
  'paragraph' | `heading${1 | 2 | 3 | 4 | 5 | 6}` | 'ordered' | 'bullet' | 'task';
export type InlineStyle = 'StrongEmphasis' | 'Emphasis';
export type SelectionFormat = {
  bold: boolean;
  italic: boolean;
  link: boolean;
  singleLine: boolean;
  block: BlockType;
};

const inlineMarkers: Record<InlineStyle, string> = { StrongEmphasis: '**', Emphasis: '*' };
const blockPrefix =
  /^([ \t]*(?:>[ \t]?)*[ \t]*)(?:(#{1,6})[ \t]+|[-*+][ \t]+(\[[ xX]\][ \t]+)?|\d+[.)][ \t]+(?:\[[ xX]\][ \t]+)?)?/;

function enclosing(state: EditorState, name: string, from: number, to: number) {
  for (let node = syntaxTree(state).resolveInner(from, 1); ; node = node.parent) {
    if (node.name === name && node.from <= from && node.to >= to) return node;
    if (!node.parent) return null;
  }
}

function blockTypeOf(text: string): BlockType {
  const match = blockPrefix.exec(text)!;
  const marker = match[0].slice(match[1]!.length);
  if (match[2]) return `heading${match[2].length as 1 | 2 | 3 | 4 | 5 | 6}`;
  if (/^\d/.test(marker)) return 'ordered';
  if (match[3]) return 'task';
  return marker ? 'bullet' : 'paragraph';
}

export function selectionFormat(state: EditorState): SelectionFormat {
  const { from, to } = state.selection.main;
  const first = state.doc.lineAt(from);
  return {
    bold: enclosing(state, 'StrongEmphasis', from, to) !== null,
    italic: enclosing(state, 'Emphasis', from, to) !== null,
    link: enclosing(state, 'Link', from, to) !== null,
    singleLine: first.number === state.doc.lineAt(to).number,
    block: blockTypeOf(first.text),
  };
}

export function toggleInline(view: EditorView, style: InlineStyle) {
  const { state } = view;
  const { from, to } = state.selection.main;
  const marker = inlineMarkers[style];
  const [open, close] = enclosing(state, style, from, to)?.getChildren('EmphasisMark') ?? [];
  if (open && close) {
    const text = state.sliceDoc(open.to, close.from);
    let left = Math.max(from, open.to) - open.to;
    while (left > 0 && /\s/.test(text[left - 1]!)) left -= 1;
    let right = Math.min(to, close.from) - open.to;
    while (right < text.length && /\s/.test(text[right]!)) right += 1;
    const keepLeft = left > 0;
    const keepRight = right < text.length;
    view.dispatch({
      changes: [
        { from: open.from, to: open.to, insert: keepLeft ? marker : '' },
        ...(keepLeft ? [{ from: open.to + left, insert: marker }] : []),
        ...(keepRight ? [{ from: open.to + right, insert: marker }] : []),
        { from: close.from, to: close.to, insert: keepRight ? marker : '' },
      ],
    });
    return;
  }
  const changes: ChangeSpec[] = [];
  for (let line = state.doc.lineAt(from); ; line = state.doc.line(line.number + 1)) {
    const contentFrom = line.from + blockPrefix.exec(line.text)![0].length;
    const text = state.sliceDoc(Math.max(from, contentFrom), Math.min(to, line.to));
    const start = Math.max(from, contentFrom) + text.length - text.trimStart().length;
    const end = start + text.trim().length;
    if (end > start) changes.push({ from: start, insert: marker }, { from: end, insert: marker });
    if (line.to >= to) break;
  }
  view.dispatch({ changes });
}

export function setLink(view: EditorView, url: string) {
  const { from, to } = view.state.selection.main;
  const target = url.replace(/[\s()<>]/g, encodeURIComponent);
  view.dispatch({
    changes: [
      { from, insert: '[' },
      { from: to, insert: `](${target})` },
    ],
  });
}

export function removeLink(view: EditorView) {
  const { state } = view;
  const { from, to } = state.selection.main;
  const link = enclosing(state, 'Link', from, to);
  const [open, close] = link?.getChildren('LinkMark') ?? [];
  if (!link || !open || !close) return;
  view.dispatch({ changes: [open, { from: close.from, to: link.to }] });
}

export function setBlockType(view: EditorView, type: BlockType) {
  const { state } = view;
  const { from, to } = state.selection.main;
  const changes: ChangeSpec[] = [];
  let index = 0;
  for (let line = state.doc.lineAt(from); ; line = state.doc.line(line.number + 1)) {
    if (line.text.trim() && blockTypeOf(line.text) !== type) {
      const match = blockPrefix.exec(line.text)!;
      const indent = match[1]!;
      const marker =
        type === 'paragraph'
          ? indent
          : type === 'bullet'
            ? `${indent}- `
            : type === 'task'
              ? `${indent}- [ ] `
              : type === 'ordered'
                ? `${indent}${index + 1}. `
                : `${indent.trimStart()}${'#'.repeat(Number(type.slice('heading'.length)))} `;
      changes.push({ from: line.from, to: line.from + match[0].length, insert: marker });
    }
    if (line.text.trim()) index += 1;
    if (line.to >= to) break;
  }
  view.dispatch({ changes });
}
