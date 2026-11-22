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

it('已连接应用单列一类，推荐区保持 6 个，授权失败后可在当前页重新连接', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const open = vi.spyOn(window, 'open').mockReturnValue(null);
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  const queries = new QueryClient();
  const Page = connectorsView.pages!.connectors!.component;
  const authorizationUrl = 'https://example.test/connect';
  let notionStatus: string | undefined;
  let failAccountsRefresh = false;
  invoke.mockImplementation(async (channel: string) => {
    switch (channel) {
      case 'connectors:configured':
        return true;
      case 'connectors:catalog':
        return [
          'gmail',
          'googlecalendar',
          'googledrive',
          'notion',
          'github',
          'slack',
          'outlook',
        ].map((slug) => ({
          slug,
          name: slug,
          logo: `https://logos.test/${slug}`,
        }));
      case 'connectors:accounts':
        if (failAccountsRefresh) throw new Error('HTTP 400');
        return [
          { id: 'first', toolkit: { slug: 'gmail' }, status: 'ACTIVE' },
          { id: 'second', toolkit: { slug: 'gmail' }, status: 'ACTIVE' },
          ...(notionStatus
            ? [{ id: 'notion-account', toolkit: { slug: 'notion' }, status: notionStatus }]
            : []),
        ];
      case 'connectors:connect':
        return { redirect_url: authorizationUrl, connected_account_id: 'notion-account' };
      case 'connectors:disconnect':
        failAccountsRefresh = true;
        return undefined;
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
    const section = (title: string) =>
      Array.from(host.querySelectorAll(`section[aria-label="${title}"] [role="group"]`), (item) =>
        item.getAttribute('aria-label'),
      );
    await vi.waitFor(() => expect(section('Connected')).toEqual(['gmail']));
    expect(section('Recommended')).toEqual([
      'googlecalendar',
      'googledrive',
      'notion',
      'github',
      'slack',
      'outlook',
    ]);
    expect(host.querySelectorAll('[role="group"][aria-label="gmail"]')).toHaveLength(1);

    const notion = () =>
      host.querySelector<HTMLButtonElement>('[role="group"][aria-label="notion"] button')!;
    await act(async () => notion().click());
    await vi.waitFor(() => expect(notion().textContent).toBe('打开授权页'));
    notionStatus = 'INITIATED';
    await act(async () => queries.refetchQueries({ queryKey: ['connectors', 'accounts'] }));
    await act(async () => notion().click());
    expect(open.mock.calls.map(([url]) => url)).toEqual([authorizationUrl, authorizationUrl]);
    expect(invoke.mock.calls.filter(([channel]) => channel === 'connectors:connect')).toHaveLength(
      1,
    );

    notionStatus = 'FAILED';
    await act(async () => queries.refetchQueries({ queryKey: ['connectors', 'accounts'] }));
    await vi.waitFor(() => expect(notion().textContent).toBe('连接'));
    await act(async () => notion().click());
    await vi.waitFor(() =>
      expect(
        invoke.mock.calls.filter(([channel]) => channel === 'connectors:connect'),
      ).toHaveLength(2),
    );

    notionStatus = 'ACTIVE';
    await act(async () => queries.refetchQueries({ queryKey: ['connectors', 'accounts'] }));
    await vi.waitFor(() => expect(section('Connected')).toContain('notion'));
    await act(async () => {
      notion().dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    });
    await act(async () => document.querySelector<HTMLElement>('[role="menuitem"]')!.click());
    await act(async () => {
      const dialog = document.querySelector('[role="alertdialog"]')!;
      const disconnect = Array.from(dialog.querySelectorAll('button')).find(
        (button) => button.textContent === '断开账户',
      )!;
      disconnect.click();
    });
    await vi.waitFor(() => expect(section('Connected')).toEqual(['gmail']));
    expect(invoke).toHaveBeenCalledWith('connectors:disconnect', 'notion-account');

    const development = Array.from(host.querySelectorAll('button')).find(
      (button) => button.textContent === 'Development',
    )!;
    await act(async () => development.click());
    expect(
      Array.from(host.querySelectorAll('section[aria-label]'), (item) =>
        item.getAttribute('aria-label'),
      ).filter((title) => title !== 'Composio'),
    ).toEqual(['Development']);
    expect(section('Development')).toEqual(['github']);
  } finally {
    await act(async () => root.unmount());
    queries.clear();
    host.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  }
});
