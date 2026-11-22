// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { UpdateSnapshot } from '../../../../src/modules/update/contract';
const bridge = vi.hoisted(() => {
  const procedures = new Map<string, () => Promise<unknown>>();
  const delion = {
    bridge: {
      invoke: async (channel: string) => procedures.get(channel)?.(),
      subscribe: () => () => {},
    },
  } as unknown as NonNullable<typeof window.delionBot>;
  window.delionBot = delion;
  return { procedures, delion };
});
import { UpdatePrompt } from '../../../../src/modules/update/view/UpdatePrompt';
import { useUpdateState } from '../../../../src/modules/update/view/update';

const readyState: UpdateSnapshot = {
  phase: 'ready',
  currentVersion: '1.0.0',
  version: '1.0.1',
  progress: 1,
  transferred: 0,
  total: null,
  checkedAt: null,
  reason: null,
  detail: null,
  failedAt: null,
};

let container: HTMLDivElement;
let root: Root;

function button(text: string): HTMLButtonElement {
  const element = [...document.body.querySelectorAll('button')].find(
    (item) => item.textContent?.trim() === text,
  );
  if (!element) throw new Error(`Missing button: ${text}`);
  return element;
}

async function show(snapshot: UpdateSnapshot | null) {
  await act(async () => {
    useUpdateState.setState({ snapshot });
    root.render(<UpdatePrompt />);
  });
}

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  for (const name of ['state', 'check', 'download', 'install', 'deferInstall'])
    bridge.procedures.set(`update:${name}`, async () => readyState);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  useUpdateState.setState({ snapshot: null, preparingInstall: false, dismissedVersion: null });
  bridge.procedures.clear();
  window.delionBot = bridge.delion;
  vi.unstubAllGlobals();
});

it('只有下载完成才弹：其它阶段都不打扰用户', async () => {
  const quiet = ['idle', 'checking', 'up-to-date', 'available', 'downloading'];
  for (const phase of quiet) {
    await show({ ...readyState, phase } as UpdateSnapshot);
    expect(document.body.querySelector('[role="dialog"]'), phase).toBeNull();
  }
});

it('答过就不再出现，但下一版下载完会重新问', async () => {
  await show(readyState);
  await act(async () => button('下次启动时提醒').click());
  await show(readyState);
  expect(document.body.querySelector('[role="dialog"]')).toBeNull();

  await show({ ...readyState, phase: 'downloading', progress: 0.5 });
  await show({ ...readyState, version: '1.0.2' });
  expect(document.body.textContent).toContain('1.0.2');
});

it('保存与安装期间保持模态锁，Esc 不能解除', async () => {
  await show(readyState);
  await act(async () => useUpdateState.setState({ preparingInstall: true }));
  expect(document.body.querySelector('[role="dialog"]')).not.toBeNull();
  expect(document.querySelectorAll('[role="dialog"] button')).toHaveLength(0);
  await act(async () => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  });
  expect(document.body.querySelector('[role="dialog"]')).not.toBeNull();
  await show({ ...readyState, phase: 'installing' });
  expect(document.body.querySelector('[role="dialog"]')).not.toBeNull();
  expect(document.querySelectorAll('[role="dialog"] button')).toHaveLength(0);
});
