// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { ConfirmDialog } from '../../src/ui/Dialog';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

it('需要确认风险时，勾选前不能确认', async () => {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  const onConfirm = vi.fn();
  await act(async () =>
    root.render(
      <ConfirmDialog
        open
        onOpenChange={() => {}}
        title="启用完全访问？"
        description="说明"
        confirmLabel="启用"
        onConfirm={onConfirm}
        acknowledgement="我已了解风险，并愿意继续"
      />,
    ),
  );
  const confirm = [...document.querySelectorAll('button')].find(
    (button) => button.textContent === '启用',
  )!;
  expect(confirm.disabled).toBe(true);

  await act(async () =>
    document.querySelector<HTMLInputElement>('[data-slot="checkbox"]')!.click(),
  );
  expect(confirm.disabled).toBe(false);
  await act(async () => confirm.click());
  expect(onConfirm).toHaveBeenCalledOnce();

  await act(async () => root.unmount());
  host.remove();
});
