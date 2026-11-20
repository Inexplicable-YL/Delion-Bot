import { expect, it, vi } from 'vitest';
import { connectorsModule } from '../../../../src/modules/connectors';
import { provideTestHostPorts } from '../../../core/host-mock';

it('保留配置直到新密钥验证通过，并只暴露当前用户的账户摘要', async () => {
  const fetch = vi.fn<typeof globalThis.fetch>();
  provideTestHostPorts({ network: { fetch } });
  const ipc = connectorsModule.ipc!;
  fetch.mockResolvedValueOnce(
    Response.json({ session_id: 'session', mcp: { url: 'https://example.com/mcp' } }),
  );
  await ipc.call('setup', 'test-key');
  const setup = JSON.parse(String(fetch.mock.calls[0]?.[1]?.body));
  expect(setup.toolkits.enable).toContain('gmail');
  fetch.mockResolvedValueOnce(new Response(null, { status: 401 }));
  await expect(ipc.call('setup', 'invalid')).rejects.toThrow('项目密钥');
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
  const [url, options] = fetch.mock.calls[2]!;
  expect(new URL(String(url)).searchParams.get('user_ids')).toBe(setup.user_id);
  expect(new Headers(options?.headers).get('x-api-key')).toBe('test-key');
  fetch.mockResolvedValueOnce(Response.json({ items: [] }));
  await expect(ipc.call('disconnect', 'other-account')).rejects.toThrow('未找到');
  expect(fetch).toHaveBeenCalledTimes(4);
});
