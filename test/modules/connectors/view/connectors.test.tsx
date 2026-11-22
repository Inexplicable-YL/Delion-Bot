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

it('已连接应用单列一类，推荐区补位保持 6 个，重复打开待授权链接时复用原链接', async () => {
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
    await act(async () => notion().click());
    expect(open.mock.calls.map(([url]) => url)).toEqual([authorizationUrl, authorizationUrl]);
    expect(invoke.mock.calls.filter(([channel]) => channel === 'connectors:connect')).toHaveLength(
      1,
    );

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
