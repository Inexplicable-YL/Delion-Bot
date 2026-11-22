// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { DocumentContent, TabId } from '../../../../src/modules/workspace/contract';

const { read, delion } = vi.hoisted(() => {
  const read = vi.fn<(id: string) => Promise<DocumentContent>>();
  const delion = {
    bridge: {
      invoke: (channel: string, input: never) =>
        channel === 'workspace:read' ? read(input) : Promise.resolve(null),
      subscribe: () => () => {},
    },
  } as unknown as NonNullable<typeof window.delionBot>;
  window.delionBot = delion;
  return { read, delion };
});

vi.mock('../../../../src/modules/note/view/MarkdownEditor', () => ({
  MarkdownEditor: ({ value }: { value: string }) => <pre data-testid="editor">{value}</pre>,
}));
vi.mock('../../../../src/modules/note/view/DocumentToolbar', () => ({
  DocumentToolbar: () => null,
}));

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
});

it('载入草稿后重新渲染不会释放并重新读取文件', async () => {
  await act(async () =>
    root.render(
      <NoteDraftSourceProvider source={source}>
        <NoteTab groupId="primary" tabId={'note:/repo/a.ts' as TabId} />
      </NoteDraftSourceProvider>,
    ),
  );
  await act(async () => new Promise((resolve) => setTimeout(resolve, 20)));

  expect(host.querySelector('[data-testid="editor"]')?.textContent).toBe('hello');
  expect(read).toHaveBeenCalledOnce();
});
