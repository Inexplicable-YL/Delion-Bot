import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { defineModule } from '../../app/module';
import { hostPorts, registerSecretLabel } from '../../core/ports';
import { implement } from '../../core/protocol/contract';
import { provideManagedMcp } from '../../core/capabilities/mcp';
import { account, apps, connectorsContract } from './contract';

const session = z.object({
  session_id: z.string(),
  mcp: z.object({
    url: z.url({ protocol: /^https$/ }),
    headers: z.record(z.string(), z.string()).optional(),
  }),
});
const config = z.object({ key: z.string(), user: z.string(), id: z.uuid(), session });
function saved() {
  const raw = hostPorts().secrets.read('composio');
  return raw ? config.parse(JSON.parse(raw)) : null;
}
function configured() {
  const value = saved();
  if (!value) throw new Error('请先配置 Composio 项目密钥。');
  return value;
}
async function request(key: string, path: string, method = 'GET', body?: unknown) {
  const response = await hostPorts().network.fetch(
    'https://backend.composio.dev/api/v3.1/' + path,
    {
      method,
      headers: { 'x-api-key': key, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(20000),
    },
  );
  if (!response.ok)
    throw new Error(
      response.status === 401 || response.status === 403
        ? 'Composio 拒绝访问，请检查项目密钥和权限。'
        : 'Composio 请求失败（' + response.status + '），请稍后重试。',
    );
  return method === 'DELETE' ? null : response.json();
}
async function accounts() {
  const { key, user } = configured();
  const items: z.infer<typeof account>[] = [];
  let cursor: string | null = null;
  do {
    const query = new URLSearchParams({ user_ids: user, limit: '100' });
    if (cursor) query.set('cursor', cursor);
    const page = z
      .object({ items: z.array(account), next_cursor: z.string().nullish() })
      .parse(await request(key, 'connected_accounts?' + query));
    items.push(...page.items);
    cursor = page.next_cursor ?? null;
  } while (cursor);
  return items;
}
export const connectorsModule = defineModule({
  id: 'connectors',
  register() {
    registerSecretLabel('composio', 'Composio 连接器');
    provideManagedMcp(() => {
      const value = saved();
      return value
        ? {
            id: value.id,
            name: 'Composio',
            enabled: true,
            transport: 'http',
            url: value.session.mcp.url,
            headers: value.session.mcp.headers ?? { 'x-api-key': value.key },
          }
        : null;
    });
  },
  ipc: implement(connectorsContract, {
    configured: () => Boolean(saved()),
    async setup(key) {
      const user = saved()?.user ?? randomUUID();
      const result = session.parse(
        await request(key, 'tool_router/session', 'POST', {
          user_id: user,
          toolkits: { enable: Object.keys(apps) },
          instant: false,
          manage_connections: { enable: true },
          workbench: { enable: false },
        }),
      );
      hostPorts().secrets.write(
        'composio',
        JSON.stringify({ key, user, id: randomUUID(), session: result }),
      );
    },
    accounts,
    async connect(toolkit) {
      const value = configured();
      return z
        .object({ redirect_url: z.url({ protocol: /^https$/ }) })
        .parse(
          await request(
            value.key,
            'tool_router/session/' + encodeURIComponent(value.session.session_id) + '/link',
            'POST',
            { toolkit },
          ),
        ).redirect_url;
    },
    async disconnect(id) {
      const value = configured();
      if (!(await accounts()).some((item) => item.id === id)) throw new Error('未找到此账户。');
      await request(value.key, 'connected_accounts/' + encodeURIComponent(id), 'DELETE');
    },
  }),
});
