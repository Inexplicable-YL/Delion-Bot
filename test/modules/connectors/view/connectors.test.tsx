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

it('已连接应用单列一类，推荐区保持 6 个，授权失败后可在当前页重新连接；供应商开关互斥并只展开已启用的供应商', async () => {
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
  let active = 'composio';
  invoke.mockImplementation(async (channel: string, input: unknown) => {
    switch (channel) {
      case 'capabilities:listMcpServers':
        return [];
      case 'connectors:status':
        return { active, configured: { composio: true, pipedream: true } };
      case 'connectors:activate':
        active = String(input);
        return undefined;
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
        if (input === 'pipedream') return [];
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
    const provider = (name: string) => host.querySelector(`section[aria-label="${name}"]`)!;
    const composio = () => provider('Composio');
    const section = (title: string) =>
      Array.from(
        composio().querySelectorAll(`section[aria-label="${title}"] [role="group"]`),
        (item) => item.getAttribute('aria-label'),
      );
    await vi.waitFor(() => expect(section('Connected')).toEqual(['gmail']));
    expect(composio().querySelector('details')!.open).toBe(true);
    expect(provider('Pipedream').querySelector('details')!.open).toBe(false);
    const custom = Array.from(host.querySelectorAll('details')).at(-1)!;
    const summary = custom.querySelector('summary')!;
    const scrollIntoView = vi.fn();
    Object.defineProperty(custom, 'scrollIntoView', { value: scrollIntoView });
    await vi.waitFor(() => expect(custom.open).toBe(true));
    await act(async () => summary.click());
    expect(custom.open).toBe(false);
    await act(async () => summary.click());
    expect(custom.open).toBe(true);
    await vi.waitFor(() => expect(scrollIntoView).toHaveBeenCalledWith({ block: 'nearest' }));
    expect(section('Recommended')).toEqual([
      'googlecalendar',
      'googledrive',
      'notion',
      'github',
      'slack',
      'outlook',
    ]);
    expect(composio().querySelectorAll('[role="group"][aria-label="gmail"]')).toHaveLength(1);

    const notion = () =>
      composio().querySelector<HTMLButtonElement>('[role="group"][aria-label="notion"] button')!;
    await act(async () => notion().click());
    await vi.waitFor(() => expect(notion().textContent).toBe('打开授权页'));
    notionStatus = 'INITIATED';
    await act(async () =>
      queries.refetchQueries({ queryKey: ['connectors', 'composio', 'accounts'] }),
    );
    await act(async () => notion().click());
    expect(open.mock.calls.map(([url]) => url)).toEqual([authorizationUrl, authorizationUrl]);
    expect(invoke.mock.calls.filter(([channel]) => channel === 'connectors:connect')).toHaveLength(
      1,
    );

    notionStatus = 'FAILED';
    await act(async () =>
      queries.refetchQueries({ queryKey: ['connectors', 'composio', 'accounts'] }),
    );
    await vi.waitFor(() => expect(notion().textContent).toBe('连接'));
    await act(async () => notion().click());
    await vi.waitFor(() =>
      expect(
        invoke.mock.calls.filter(([channel]) => channel === 'connectors:connect'),
      ).toHaveLength(2),
    );

    notionStatus = 'ACTIVE';
    await act(async () =>
      queries.refetchQueries({ queryKey: ['connectors', 'composio', 'accounts'] }),
    );
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
    expect(invoke).toHaveBeenCalledWith('connectors:disconnect', {
      provider: 'composio',
      id: 'notion-account',
    });

    const development = Array.from(composio().querySelectorAll('button')).find(
      (button) => button.textContent === 'Development',
    )!;
    await act(async () => development.click());
    expect(
      Array.from(composio().querySelectorAll('section[aria-label]'), (item) =>
        item.getAttribute('aria-label'),
      ),
    ).toEqual(['Development']);
    expect(section('Development')).toEqual(['github']);

    await act(async () =>
      provider('Pipedream').querySelector<HTMLButtonElement>('[role="switch"]')!.click(),
    );
    expect(invoke).toHaveBeenCalledWith('connectors:activate', 'pipedream');
    expect(provider('Pipedream').querySelector('details')!.open).toBe(true);
    expect(composio().querySelector('details')!.open).toBe(false);
    await vi.waitFor(() =>
      expect(composio().querySelector('[role="switch"]')!.getAttribute('aria-checked')).toBe(
        'false',
      ),
    );
    Object.defineProperty(composio().querySelector('details')!, 'scrollIntoView', {
      value: vi.fn(),
    });
    await act(async () => composio().querySelector('summary')!.click());
    expect(composio().querySelector('details')!.open).toBe(true);
  } finally {
    await act(async () => root.unmount());
    queries.clear();
    host.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  }
});
