// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { ErrorCard, MessageChip } from '../../../src/ui/agent/Message';
import { Trace } from '../../../src/ui/agent/Trace';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

async function render(node: React.ReactNode) {
  const host = document.createElement('div');
  document.body.append(host);
  await act(async () => createRoot(host).render(node));
  return host;
}

it('错误卡只在提供 onRetry 时出现重试按钮，点击触发回调', async () => {
  const onRetry = vi.fn();
  const withRetry = await render(<ErrorCard onRetry={onRetry} reason="失败" />);
  await act(async () => withRetry.querySelector('button')!.click());
  expect(onRetry).toHaveBeenCalledOnce();
  const without = await render(<ErrorCard reason="失败" />);
  expect(without.querySelector('button')).toBeNull();
});

it('chip 有 onClick 时是按钮，否则是纯文本', async () => {
  const onClick = vi.fn();
  const host = await render(
    <>
      <MessageChip onClick={onClick}>可点</MessageChip>
      <MessageChip>纯文本</MessageChip>
    </>,
  );
  expect(host.querySelectorAll('button')).toHaveLength(1);
  await act(async () => host.querySelector('button')!.click());
  expect(onClick).toHaveBeenCalledOnce();
});

it('给出 foldLabel 时过程块被隐藏，展开后可见，最后一块始终可见', async () => {
  const host = await render(
    <Trace
      blocks={[
        { key: 0, node: <p>过程</p> },
        { key: 1, node: <p>结论</p> },
      ]}
      foldLabel="已处理"
    />,
  );
  const process = host.querySelector('p')!.parentElement!;
  expect(process.hidden).toBe(true);
  await act(async () => host.querySelector<HTMLButtonElement>('button[aria-expanded]')!.click());
  expect(process.hidden).toBe(false);
  expect(host.querySelectorAll('[hidden]')).toHaveLength(0);
});

it('运行中过程折叠为当前步骤一行，展开后显示处理时长与完整过程，正文始终可见', async () => {
  const host = await render(
    <Trace
      blocks={[
        { key: 0, node: <p>思考</p> },
        { key: 1, node: <p>工具</p> },
        { key: 2, node: <p>正文</p> },
      ]}
      running={{
        current: '运行 pnpm test',
        startedAt: Date.now(),
        keepLast: true,
        formatElapsed: () => '5 秒',
      }}
    />,
  );
  const toggle = host.querySelector<HTMLButtonElement>('button[aria-expanded]')!;
  expect(toggle.textContent).toContain('运行 pnpm test');
  expect(host.querySelector('[hidden]')!.textContent).toBe('思考工具');
  await act(async () => toggle.click());
  expect(toggle.textContent).toContain('处理中 5 秒');
  expect(host.querySelectorAll('[hidden]')).toHaveLength(0);
  expect(host.textContent).toContain('正文');
});
