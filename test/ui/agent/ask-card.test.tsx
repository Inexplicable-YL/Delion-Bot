// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AskCard, type AskCardGroup } from '../../../src/ui/agent/AskCard';

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

const groups: AskCardGroup[] = [
  { question: '用哪种数据库？', options: [{ label: 'PostgreSQL' }, { label: 'SQLite' }] },
  { question: '支持哪些平台？', options: [{ label: 'Web' }, { label: 'iOS' }], multiple: true },
];

const options = () => [...host.querySelectorAll<HTMLButtonElement>('[aria-checked]')];
const button = (label: string) =>
  [...host.querySelectorAll<HTMLButtonElement>('button')].find(
    (item) => item.textContent === label,
  );

async function render(onSubmit: (answers: string[][]) => Promise<void>) {
  await act(async () => root.render(<AskCard groups={groups} onSubmit={onSubmit} />));
}

it('分页作答，单选只保留一个选项，多选可以同时选中多个', async () => {
  const onSubmit = vi.fn(async () => {});
  await render(onSubmit);

  expect(button('下一步')?.disabled).toBe(true);
  await act(async () => options()[0]!.click());
  await act(async () => options()[1]!.click());
  expect(options().map((option) => option.getAttribute('aria-checked'))).toEqual([
    'false',
    'true',
    'false',
  ]);
  await act(async () => button('下一步')!.click());

  await act(async () => options()[0]!.click());
  await act(async () => options()[1]!.click());
  await act(async () => button('发送')!.click());
  expect(onSubmit).toHaveBeenCalledWith([['SQLite'], ['Web', 'iOS']]);
});

it('“其他”只在填写内容后选中，并随答案发出', async () => {
  const onSubmit = vi.fn(async () => {});
  await render(onSubmit);

  const other = host.querySelector<HTMLInputElement>('input[aria-label="其他回答"]')!;
  const type = (value: string) => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(other, value);
    other.dispatchEvent(new Event('input', { bubbles: true }));
  };
  await act(async () => other.focus());
  expect(options().at(-1)!.getAttribute('aria-checked')).toBe('false');
  await act(async () => type(' MySQL '));
  expect(options().at(-1)!.getAttribute('aria-checked')).toBe('true');
  await act(async () => button('下一步')!.click());
  await act(async () => button('跳过')!.click());
  expect(onSubmit).toHaveBeenCalledWith([['MySQL'], []]);
});

it('Esc 跳过全部问题', async () => {
  const onSubmit = vi.fn(async () => {});
  await render(onSubmit);

  await act(async () => options()[0]!.click());
  await act(async () =>
    options()[0]!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })),
  );
  expect(onSubmit).toHaveBeenCalledWith([[], []]);
});
