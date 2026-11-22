// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { SessionRow } from '../../../../src/app/renderer/navigation/SessionRow';
import { useNavigationStore } from '../../../../src/app/renderer/navigation/view';
import { TabGroup } from '../../../../src/app/renderer/workbench/TabGroup';
import {
  createDefaultLayout,
  findGroup,
} from '../../../../src/app/renderer/workbench/layout-schema';
import {
  saveWorkbenchLayout,
  useWorkbenchLayout,
} from '../../../../src/app/renderer/workbench/layout-store';

vi.hoisted(() => {
  vi.stubGlobal('matchMedia', () => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
  }));
});

vi.mock('../../../../src/app/renderer/workbench/registry', () => ({
  kindOf: () => 'chat',
  registry: { chat: { component: () => null, icon: () => null } },
  titleOf: (tab: string) => tab,
}));

let host: HTMLDivElement;
let root: Root;

function Fixture({ archived }: { archived: boolean }) {
  const group = useWorkbenchLayout((state) => findGroup(state.root, 'primary'))!;
  return (
    <>
      <SessionRow
        onMove={() => {}}
        onOpen={() => {}}
        projectId="another-project"
        session={{ id: 'sidebar', title: '侧栏会话', updatedAt: '', createdAt: '', archived }}
      />
      <TabGroup group={group} onNewChat={() => {}} />
    </>
  );
}

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  Element.prototype.scrollIntoView = () => {};
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  useNavigationStore.setState({ restoreRequest: null });
  useWorkbenchLayout.setState({
    ...createDefaultLayout(),
    projectId: 'current-project',
    ready: true,
  });
});

afterEach(async () => {
  await act(async () => root.unmount());
  await saveWorkbenchLayout();
  host.remove();
  delete (Element.prototype as Partial<Element>).scrollIntoView;
});

async function render(archived = false) {
  await act(async () =>
    root.render(
      <QueryClientProvider client={new QueryClient()}>
        <Fixture archived={archived} />
      </QueryClientProvider>,
    ),
  );
}

async function dragTo(target: Element) {
  const payload = new Map<string, string>();
  const transfer = {
    get types() {
      return [...payload.keys()];
    },
    getData: (type: string) => payload.get(type) ?? '',
    setData: (type: string, value: string) => payload.set(type, value),
  };
  const dispatch = (element: Element, name: string) => {
    const event = new MouseEvent(name, { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'dataTransfer', { value: transfer });
    element.dispatchEvent(event);
    return event;
  };
  await act(async () => {
    dispatch(host.querySelector('[draggable]')!, 'dragstart');
    expect(dispatch(target, 'dragover').defaultPrevented).toBe(true);
    dispatch(target, 'drop');
  });
}

const group = () => findGroup(useWorkbenchLayout.getState().root, 'primary')!;

it('侧栏会话可落在当前工作台的指定标签位，重复拖入会聚焦已有标签', async () => {
  for (const tab of ['chat:existing', 'chat:last'] as const)
    useWorkbenchLayout.getState().openTab(tab);
  await render();
  const target = host.querySelector('[data-tab="chat:last"]')!;
  await dragTo(target);
  expect(group().tabs).toEqual(['chat:existing', 'chat:sidebar', 'chat:last']);
  expect(group().active).toBe('chat:sidebar');
  await dragTo(target);
  expect(group().tabs).toEqual(['chat:existing', 'chat:sidebar', 'chat:last']);
  expect(useWorkbenchLayout.getState().projectId).toBe('current-project');
});

it('空工作组可接收首个会话，归档会话先请求恢复', async () => {
  await render(true);
  const target = host.querySelector('section button')!;
  await dragTo(target);
  expect(useNavigationStore.getState().restoreRequest).toMatchObject({
    kind: 'chat',
    title: '侧栏会话',
  });
  expect(group().tabs).toEqual([]);

  await render();
  await dragTo(host.querySelector('section button')!);
  expect(group().tabs).toEqual(['chat:sidebar']);
});
