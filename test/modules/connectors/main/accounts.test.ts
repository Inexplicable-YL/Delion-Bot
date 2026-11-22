import { expect, it, vi } from 'vitest';
import { connectorsModule } from '../../../../src/modules/connectors';
import { provideTestHostPorts } from '../../../core/host-mock';

const projectMissingAuthConfigs = () =>
  Response.json(
    {
      error: {
        code: 4300,
        message:
          'The following toolkits require auth configs but none exist and cannot be auto-created: lark, twitter. Please specify them in auth_configs.',
      },
    },
    { status: 400 },
  );

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

it('授权链接请求返回 400 时提供错误代码和请求编号', async () => {
  const fetch = vi.fn<typeof globalThis.fetch>();
  provideTestHostPorts({ network: { fetch } });
  const ipc = connectorsModule.ipc!;
  fetch
    .mockResolvedValueOnce(Response.json({ items: [] }))
    .mockResolvedValueOnce(
      Response.json({ session_id: 'session', mcp: { url: 'https://example.com/mcp' } }),
    )
    .mockResolvedValueOnce(
      Response.json(
        { error: { code: 123, request_id: 'req_link123', message: 'private-key' } },
        { status: 400 },
      ),
    );
  await ipc.call('setup', 'private-key');
  await expect(ipc.call('connect', 'gmail')).rejects.toThrow(
    /^Composio 拒绝生成授权链接（HTTP 400）。错误代码 123。请求编号 req_link123。$/,
  );
  expect(fetch).toHaveBeenCalledTimes(3);
});

it('缺少部分应用的授权配置时，仍可保存项目密钥并连接其余应用', async () => {
  const fetch = vi.fn<typeof globalThis.fetch>();
  provideTestHostPorts({ network: { fetch } });
  const ipc = connectorsModule.ipc!;
  fetch
    .mockResolvedValueOnce(Response.json({ items: [] }))
    .mockResolvedValueOnce(projectMissingAuthConfigs())
    .mockResolvedValueOnce(
      Response.json({ session_id: 'session', mcp: { url: 'https://example.com/mcp' } }),
    )
    .mockResolvedValueOnce(Response.json({ error: { code: 4324 } }, { status: 400 }))
    .mockResolvedValueOnce(projectMissingAuthConfigs());
  await ipc.call('setup', 'test-key');
  const first = JSON.parse(String(fetch.mock.calls[1]?.[1]?.body));
  const retry = JSON.parse(String(fetch.mock.calls[2]?.[1]?.body));
  expect(retry).toEqual({
    ...first,
    toolkits: {
      enable: first.toolkits.enable.filter((slug: string) => !['lark', 'twitter'].includes(slug)),
    },
  });
  await expect(ipc.call('connect', 'twitter')).rejects.toThrow(/twitter.*Auth Config/);
  expect(fetch).toHaveBeenCalledTimes(5);
  expect(await ipc.call('configured', undefined)).toBe(true);
});

it('旧会话缺少目录中的应用时沿用用户创建会话并重试授权', async () => {
  const fetch = vi.fn<typeof globalThis.fetch>();
  provideTestHostPorts({ network: { fetch } });
  const ipc = connectorsModule.ipc!;
  const savedSession = { session_id: 'session', mcp: { url: 'https://example.com/mcp' } };
  const link = { connected_account_id: 'ca_zoom', redirect_url: 'https://example.com/authorize' };
  fetch
    .mockResolvedValueOnce(Response.json({ items: [] }))
    .mockResolvedValueOnce(Response.json(savedSession))
    .mockResolvedValueOnce(Response.json({ error: { code: 4324 } }, { status: 400 }))
    .mockResolvedValueOnce(projectMissingAuthConfigs())
    .mockResolvedValueOnce(Response.json({ ...savedSession, session_id: 'replacement' }))
    .mockResolvedValueOnce(Response.json(link))
    .mockResolvedValueOnce(Response.json(link));
  await ipc.call('setup', 'test-key');
  await expect(ipc.call('connect', 'zoom')).resolves.toEqual(link);
  await expect(ipc.call('connect', 'zoom')).resolves.toEqual(link);
  const calls = fetch.mock.calls.slice(2);
  expect(calls.map(([url, options]) => [new URL(String(url)).pathname, options?.method])).toEqual([
    ['/api/v3.1/tool_router/session/session/link', 'POST'],
    ['/api/v3.1/tool_router/session', 'POST'],
    ['/api/v3.1/tool_router/session', 'POST'],
    ['/api/v3.1/tool_router/session/replacement/link', 'POST'],
    ['/api/v3.1/tool_router/session/replacement/link', 'POST'],
  ]);
  const original = JSON.parse(String(fetch.mock.calls[1]?.[1]?.body));
  const replacement = JSON.parse(String(calls[2]?.[1]?.body));
  expect(replacement.user_id).toBe(original.user_id);
  expect(replacement.toolkits.enable).toEqual(expect.arrayContaining(['gmail', 'zoom']));
});
