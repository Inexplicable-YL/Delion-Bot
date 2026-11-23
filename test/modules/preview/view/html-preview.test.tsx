// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { ContentLoaderProvider } from '../../../../src/modules/preview/view/Loader';
import { PreviewTab } from '../../../../src/modules/preview/view/PreviewTab';

vi.mock('../../../../src/modules/preview/view/CodeViewer', () => ({
  CodeViewer: ({ value }: { value: string }) => <pre>{value}</pre>,
}));

it('switches a workspace HTML tab between sanitized preview and original source', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  const client = new QueryClient();
  const text = '<p>Report</p><script>untrusted()</script>';
  const button = (label: string) =>
    host.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
  const loadDocument = vi.fn(async () => ({
    content: { title: 'report.html', format: 'html' as const, text },
  }));

  try {
    await act(async () =>
      root.render(
        <QueryClientProvider client={client}>
          <ContentLoaderProvider
            loader={{ loadDocument, navigate: () => false, openLink: vi.fn() }}
          >
            <PreviewTab tabId="preview:/workspace/report.html" groupId="primary" />
          </ContentLoaderProvider>
        </QueryClientProvider>,
      ),
    );
    await vi.waitFor(async () => {
      await act(async () => {});
      expect(host.querySelector('iframe')?.getAttribute('srcdoc')).toContain('<p>Report</p>');
    });
    expect(host.querySelector('iframe')?.getAttribute('srcdoc')).not.toContain('untrusted()');
    await act(async () => button('源码模式')!.click());
    expect(host.querySelector('iframe')).toBeNull();
    expect(host.querySelector('pre')?.textContent).toBe(text);
    await act(async () => button('重新载入')!.click());
    expect(loadDocument).toHaveBeenCalledTimes(2);
    await act(async () => button('返回安全预览')!.click());
    expect(host.querySelector('iframe')?.getAttribute('srcdoc')).toContain('<p>Report</p>');
  } finally {
    await act(async () => root.unmount());
    client.clear();
    host.remove();
    vi.unstubAllGlobals();
  }
});
