// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Explorer, type ExplorerItem } from '../../../../src/modules/workspace/view/Explorer';

const items: ExplorerItem[] = [
  { id: 'docs', parentId: null, name: 'docs', container: true },
  { id: 'a', parentId: null, name: 'a.md' },
  { id: 'b', parentId: null, name: 'b.md' },
  { id: 'c', parentId: null, name: 'c.md' },
];

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('matchMedia', () => ({ matches: false }));
  Element.prototype.scrollIntoView = () => {};
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const row = (name: string) =>
  container.querySelector<HTMLElement>(`[role="treeitem"][aria-label="${name}"]`)!;
const selectedNames = () =>
  [...container.querySelectorAll('[role="treeitem"][aria-selected="true"]')].map((element) =>
    element.getAttribute('aria-label'),
  );
const click = (name: string, init: MouseEventInit = {}) =>
  act(() => {
    row(name).dispatchEvent(new MouseEvent('click', { bubbles: true, ...init }));
  });

function renderExplorer() {
  const onSelect = vi.fn();
  const onMove = vi.fn();
  const actions = vi.fn((item: ExplorerItem, selection: string[]) => (
    <span data-testid={`menu-${item.id}`}>{selection.join(',')}</span>
  ));
  act(() =>
    root.render(
      <Explorer
        actions={actions}
        expanded={[]}
        items={items}
        label="tree"
        onExpand={() => {}}
        onMove={onMove}
        onSelect={onSelect}
        selected="a"
      />,
    ),
  );
  return { onSelect, onMove };
}

function dragOnto(from: string, to: string) {
  const data = new Map<string, string>();
  const dataTransfer = {
    types: [] as string[],
    setData: (type: string, value: string) => data.set(type, value),
    getData: (type: string) => data.get(type) ?? '',
  };
  for (const [type, target] of [
    ['dragstart', from],
    ['dragover', to],
    ['drop', to],
  ] as const)
    act(() => {
      const event = new Event(type, { bubbles: true, cancelable: true });
      Object.assign(event, { dataTransfer });
      row(target).dispatchEvent(event);
    });
}

it('keeps the scroll position when folders change while a file is open', () => {
  const scroll = vi.spyOn(Element.prototype, 'scrollIntoView');
  const render = (expanded: string[], selected = 'a', folderReveal?: { id: string; key: string }) =>
    act(() =>
      root.render(
        <Explorer
          expanded={expanded}
          folderReveal={folderReveal}
          items={items}
          label="tree"
          onExpand={() => {}}
          onSelect={() => {}}
          selected={selected}
        />,
      ),
    );

  render([]);
  expect(scroll.mock.contexts).toEqual([row('a.md')]);
  scroll.mockClear();

  render(['docs']);
  render([]);
  expect(scroll).not.toHaveBeenCalled();

  render([], 'b');
  expect(scroll.mock.contexts).toEqual([row('b.md')]);
  scroll.mockClear();

  render(['docs'], 'docs', { id: 'docs', key: 'first' });
  render(['docs'], 'docs', { id: 'docs', key: 'second' });
  render(['docs'], 'docs');
  expect(scroll.mock.contexts).toEqual([row('docs'), row('docs')]);
});

it('keeps the scroll position when a folder changes the tree rendering mode', async () => {
  const scroll = vi.spyOn(Element.prototype, 'scrollIntoView');
  const scrollTo = vi.fn(({ top }: ScrollToOptions) => {
    if (top !== undefined) container.scrollTop = top;
  });
  container.style.overflowY = 'auto';
  Object.defineProperties(container, {
    clientHeight: { value: 120 },
    scrollHeight: { value: 4000 },
    scrollTo: { value: scrollTo },
  });
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  const treeItems = [
    ...items,
    ...Array.from({ length: 15 }, (_, index) => ({
      id: `root-${index}`,
      parentId: null,
      name: `root-${index}.md`,
    })),
    ...Array.from({ length: 100 }, (_, index) => ({
      id: `child-${index}`,
      parentId: 'docs',
      name: `child-${index}.md`,
    })),
  ];
  const render = (expanded: string[]) =>
    act(() =>
      root.render(
        <Explorer
          expanded={expanded}
          items={treeItems}
          label="tree"
          onExpand={() => {}}
          onSelect={() => {}}
          selected="a"
        />,
      ),
    );

  render([]);
  scroll.mockClear();
  container.scrollTop = 200;
  render(['docs']);
  await act(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
  expect(container.scrollTop).toBe(200);
  render([]);
  expect(scroll).not.toHaveBeenCalled();
});

describe('Explorer multi-selection', () => {
  it('extends from the current file with ctrl and shift without opening anything', () => {
    const { onSelect } = renderExplorer();
    click('c.md', { ctrlKey: true });
    expect(selectedNames()).toEqual(['a.md', 'c.md']);
    click('b.md', { shiftKey: true });
    expect(selectedNames()).toEqual(['b.md', 'c.md']);
    click('a.md', { ctrlKey: true, shiftKey: true });
    expect(selectedNames()).toEqual(['a.md', 'b.md', 'c.md']);
    expect(onSelect).not.toHaveBeenCalled();
    expect(container.querySelector('[data-testid="menu-b"]')?.textContent).toBe('b,c,a');

    click('b.md');
    expect(onSelect).toHaveBeenCalledWith('b');
    expect(selectedNames()).toEqual(['a.md']);
  });

  it('moves every selected entry when one of them is dragged', () => {
    const { onMove } = renderExplorer();
    click('b.md', { shiftKey: true });
    dragOnto('b.md', 'docs');
    expect(onMove).toHaveBeenCalledWith(['a', 'b'], 'docs');
  });

  it('right-clicking outside the selection drops it and targets only that row', () => {
    renderExplorer();
    click('b.md', { ctrlKey: true });
    act(() => {
      row('c.md').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }));
    });
    expect(container.querySelector('[data-testid="menu-c"]')?.textContent).toBe('c');
    expect(selectedNames()).toEqual(['a.md']);
  });
});
