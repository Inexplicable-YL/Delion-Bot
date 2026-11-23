// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { latestSentence, useReasoningSnippet } from '../../../src/ui/agent/Reasoning';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  vi.useRealTimers();
});

it('shows only the latest complete sentence while reasoning streams', () => {
  expect(latestSentence('先读取托盘菜单的配置文件。然后检查', false)).toBe(
    '先读取托盘菜单的配置文件。',
  );
  expect(latestSentence('Read the config file. Then check', false)).toBe('Read the config file.');
  expect(latestSentence('先读取托盘菜单', false)).toBeUndefined();
});

it('treats the trailing fragment as complete once reasoning finishes', () => {
  expect(latestSentence('先读取托盘菜单的配置文件。然后检查窗口入口逻辑', true)).toBe(
    '然后检查窗口入口逻辑',
  );
});

it('skips filler sentences and strips markdown markers', () => {
  expect(latestSentence('**Inspecting the tray menu**\n\n好的。\n', false)).toBe(
    'Inspecting the tray menu',
  );
});

function Probe({ text }: { text: string }) {
  return <>{useReasoningSnippet(text, false) ?? 'Thinking'}</>;
}

it('keeps each snippet on screen for a minimum time before replacing it', async () => {
  vi.useFakeTimers();
  const host = document.createElement('div');
  const root = createRoot(host);
  const first = '先读取托盘菜单的配置文件。';
  const second = `${first}然后检查窗口入口逻辑。`;
  await act(async () => root.render(<Probe text="先读取" />));
  expect(host.textContent).toBe('Thinking');
  await act(async () => root.render(<Probe text={first} />));
  expect(host.textContent).toBe(first);
  await act(async () => root.render(<Probe text={second} />));
  expect(host.textContent).toBe(first);
  await act(async () => vi.advanceTimersByTime(2000));
  expect(host.textContent).toBe('然后检查窗口入口逻辑。');
  act(() => root.unmount());
});
