// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { EditorView } from '@codemirror/view';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { DocumentContent, TabId } from '../../../../src/modules/workspace/contract';

const { read, delion } = vi.hoisted(() => {
  const read = vi.fn<(id: string) => Promise<DocumentContent>>();
  const delion = {
    bridge: {
      invoke: (channel: string, input: never) => {
        if (channel === 'workspace:read') return read(input);
        return Promise.resolve(channel === 'workspace:saveNote' ? 'r2' : null);
      },
      subscribe: () => () => {},
    },
  } as unknown as NonNullable<typeof window.delionBot>;
  window.delionBot = delion;
  return { read, delion };
});

import { NoteDraftSourceProvider } from '../../../../src/modules/note/view/DraftSource';
import { useNoteDrafts } from '../../../../src/modules/note/view/drafts';
import { NoteTab } from '../../../../src/modules/note/view/NoteTab';

const source = {
  resolveImage: (_entryId: string, src: string) => src,
  acquire: (entryId: string, force?: boolean) => useNoteDrafts.getState().acquire(entryId, force),
  edit: (entryId: string, text: string) => useNoteDrafts.getState().edit(entryId, text),
  save: (entryId: string) => useNoteDrafts.getState().save(entryId),
  release: (entryId: string) => useNoteDrafts.getState().release(entryId),
};

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  Range.prototype.getClientRects ??= () => Object.assign([], { item: () => null });
  Range.prototype.getBoundingClientRect ??= () => new DOMRect();
  read.mockResolvedValue({ title: 'a.ts', format: 'text', text: 'hello', revision: 'r1' });
  window.delionBot = delion;
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  delete window.delionBot;
  useNoteDrafts.setState({ drafts: {}, refcounts: {}, loading: {} });
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

const renderTab = () =>
  act(async () =>
    root.render(
      <NoteDraftSourceProvider source={source}>
        <NoteTab groupId="primary" tabId={'note:/repo/a.ts' as TabId} />
      </NoteDraftSourceProvider>,
    ),
  );

const editor = () => EditorView.findFromDOM(host.querySelector<HTMLElement>('.cm-editor')!)!;

it('载入草稿后重新渲染不会释放并重新读取文件', async () => {
  await renderTab();

  expect(editor().state.sliceDoc()).toBe('hello');
  expect(read).toHaveBeenCalledOnce();
});

it('代码文件可从顶部工具栏复制当前全文、撤销和重做', async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
  await renderTab();
  const button = (label: string) =>
    host.querySelector<HTMLButtonElement>(`[role="toolbar"] button[aria-label="${label}"]`)!;
  const undo = button('撤销');
  const redo = button('重做');
  expect(undo.disabled).toBe(true);
  expect(redo.disabled).toBe(true);

  await act(async () => editor().dispatch({ changes: { from: 5, insert: '!' } }));
  await act(async () => button('复制全文').click());
  expect(writeText).toHaveBeenCalledWith('hello!');

  await act(async () => undo.click());
  expect(editor().state.sliceDoc()).toBe('hello');
  await act(async () => redo.click());
  expect(editor().state.sliceDoc()).toBe('hello!');
  expect(redo.disabled).toBe(true);
});
