import { expect, it, vi } from 'vitest';
import { connectorsModule } from '../../../../src/modules/connectors';
import { provideTestHostPorts } from '../../../core/host-mock';

it('保留配置直到新密钥验证通过，并只暴露当前用户的账户摘要', async () => {
  const fetch = vi.fn<typeof globalThis.fetch>();
  provideTestHostPorts({ network: { fetch } });
  const ipc = connectorsModule.ipc!;
  fetch
    .mockResolvedValueOnce(Response.json({ items: [] }))
    .mockResolvedValueOnce(
      Response.json({ session_id: 'session', mcp: { url: 'https://example.com/mcp' } }),
    );
  await ipc.call('setup', 'test-key');
  const setup = JSON.parse(String(fetch.mock.calls[1]?.[1]?.body));
  expect(setup.toolkits.enable).toContain('gmail');
  fetch
    .mockResolvedValueOnce(Response.json({ items: [] }))
    .mockResolvedValueOnce(
      Response.json(
        { error: { message: 'Invalid API key: priv**key' } },
        { status: 401, headers: { 'x-request-id': 'req_session123' } },
      ),
    );
  await expect(ipc.call('setup', 'private-key')).rejects.toThrow(
    /^项目密钥可以读取账户.*Session management.*HTTP 401.*req_session123。$/,
  );
  fetch.mockResolvedValueOnce(
    Response.json({
      items: [
        { id: 'account', toolkit: { slug: 'gmail' }, status: 'ACTIVE', data: { token: 'private' } },
      ],
    }),
  );
  expect(await ipc.call('accounts', undefined)).toEqual([
    { id: 'account', toolkit: { slug: 'gmail' }, status: 'ACTIVE' },
  ]);
  const [url, options] = fetch.mock.calls[4]!;
  expect(new URL(String(url)).searchParams.get('user_ids')).toBe(setup.user_id);
  expect(new Headers(options?.headers).get('x-api-key')).toBe('test-key');
  fetch.mockResolvedValueOnce(Response.json({ items: [] }));
  await expect(ipc.call('disconnect', 'other-account')).rejects.toThrow('未找到');
  expect(fetch).toHaveBeenCalledTimes(6);
});

it('遇到用户密钥或账户读取被拒时，不发送创建会话请求', async () => {
  const fetch = vi.fn<typeof globalThis.fetch>();
  provideTestHostPorts({ network: { fetch } });
  const ipc = connectorsModule.ipc!;
  await expect(ipc.call('setup', 'uak_example')).rejects.toThrow('用户密钥');
  expect(fetch).not.toHaveBeenCalled();

  fetch.mockResolvedValueOnce(new Response(null, { status: 403 }));
  await expect(ipc.call('setup', 'unscoped-key')).rejects.toThrow(
    /拒绝读取账户.*Connected accounts.*HTTP 403/,
  );
  expect(fetch).toHaveBeenCalledTimes(1);
});
it('只向 Composio 请求精选应用，按精选顺序返回并忽略目录外条目', async () => {
  const fetch = vi.fn<typeof globalThis.fetch>();
  provideTestHostPorts({ network: { fetch } });
  const ipc = connectorsModule.ipc!;
  fetch
    .mockResolvedValueOnce(Response.json({ items: [] }))
    .mockResolvedValueOnce(
      Response.json({ session_id: 'session', mcp: { url: 'https://example.com/mcp' } }),
    );
  await ipc.call('setup', 'test-key');
  const toolkit = (slug: string) => ({
    slug,
    name: slug.toUpperCase(),
    meta: { logo: `https://logos.test/${slug}` },
  });
  fetch.mockResolvedValueOnce(
    Response.json({ items: [toolkit('notion'), toolkit('hackernews'), toolkit('gmail')] }),
  );
  expect(await ipc.call('catalog', undefined)).toEqual([
    { slug: 'gmail', name: 'GMAIL', logo: 'https://logos.test/gmail' },
    { slug: 'notion', name: 'NOTION', logo: 'https://logos.test/notion' },
  ]);
  const request = JSON.parse(String(fetch.mock.calls[2]?.[1]?.body));
  expect(request.toolkits).toEqual(expect.arrayContaining(['gmail', 'notion']));
});
