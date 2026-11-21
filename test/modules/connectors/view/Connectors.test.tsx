// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { expect, it, vi } from 'vitest';

const invoke = vi.hoisted(() => {
  const invoke = vi.fn();
  window.delionBot = {
    bridge: { invoke, subscribe: () => () => {} },
  } as unknown as NonNullable<typeof window.delionBot>;
  return invoke;
});

import { connectorsView } from '../../../../src/modules/connectors/view';

it('同一应用汇总多个账户，重复打开待授权链接时复用原链接', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const open = vi.spyOn(window, 'open').mockReturnValue(null);
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  const queries = new QueryClient();
  const Page = connectorsView.pages!.connectors!.component;
  const authorizationUrl = 'https://example.test/connect';
  invoke.mockImplementation(async (channel: string) => {
    switch (channel) {
      case 'connectors:configured':
        return true;
      case 'connectors:catalog':
        return ['gmail', 'notion'].map((slug) => ({
          slug,
          name: slug,
          logo: `https://logos.test/${slug}`,
        }));
      case 'connectors:accounts':
        return [
          { id: 'first', toolkit: { slug: 'gmail' }, status: 'ACTIVE' },
          { id: 'second', toolkit: { slug: 'gmail' }, status: 'ACTIVE' },
        ];
      case 'connectors:connect':
        return authorizationUrl;
      default:
        throw new Error(channel);
    }
  });

  try {
    await act(async () => {
      root.render(
        <QueryClientProvider client={queries}>
          <Page drawer={null} navigate={() => true} target={{ page: 'connectors' }} />
        </QueryClientProvider>,
      );
    });
    const gmail = () => host.querySelector('[role="group"][aria-label="gmail"]');
    await vi.waitFor(() => expect(gmail()?.textContent).toContain('已连接 2 个账户'));
    expect(Array.from(gmail()!.querySelectorAll('button'), (button) => button.textContent)).toEqual(
      ['管理'],
    );

    const notion = () =>
      host.querySelector<HTMLButtonElement>('[role="group"][aria-label="notion"] button')!;
    await act(async () => notion().click());
    await vi.waitFor(() => expect(notion().textContent).toBe('打开授权页'));
    await act(async () => notion().click());
    expect(open.mock.calls.map(([url]) => url)).toEqual([authorizationUrl, authorizationUrl]);
    expect(invoke.mock.calls.filter(([channel]) => channel === 'connectors:connect')).toHaveLength(
      1,
    );
  } finally {
    await act(async () => root.unmount());
    queries.clear();
    host.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  }
});
