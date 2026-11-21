import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { defineModule } from '../../app/module';
import { hostPorts, registerSecretLabel } from '../../core/ports';
import { implement } from '../../core/protocol/contract';
import { provideManagedMcp } from '../../core/capabilities/mcp';
import { account, connectorsContract, toolkit } from './contract';

const session = z.object({
  session_id: z.string(),
  mcp: z.object({
    url: z.url({ protocol: /^https$/ }),
    headers: z.record(z.string(), z.string()).optional(),
  }),
});
const config = z.object({ key: z.string(), user: z.string(), id: z.uuid(), session });
const listedToolkit = z.object({
  slug: z.string(),
  name: z.string(),
  meta: z.object({ logo: z.string() }),
});
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
  if (!response.ok) {
    const requestId = response.headers.get('x-request-id');
    const trace =
      requestId &&
      (z.uuid().safeParse(requestId).success || /^req_[a-z0-9]{6,64}$/i.test(requestId))
        ? `请求编号 ${requestId}。`
        : '';
    if (response.status === 401 || response.status === 403) {
      const reason =
        path === 'tool_router/session'
          ? '项目密钥可以读取账户，但 Composio 拒绝创建会话。请为项目密钥启用 Session management 的写入权限。'
          : path.startsWith('toolkits')
            ? 'Composio 拒绝读取应用目录。请为项目密钥启用 Toolkits 的读取权限。'
            : path.startsWith('tool_router/session/')
              ? 'Composio 拒绝生成授权链接。请检查项目密钥是否有效，以及 Session management 是否允许写入。'
              : method === 'DELETE'
                ? 'Composio 拒绝断开账户。请检查 Connected accounts 是否允许写入。'
                : 'Composio 拒绝读取账户。请从 Project Settings 复制项目 API Key，并确认 Connected accounts 允许读取。';
      throw new Error(`${reason}（HTTP ${response.status}）${trace}`);
    }
    throw new Error(`Composio 请求失败（HTTP ${response.status}），请稍后重试。${trace}`);
  }
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
async function catalog() {
  const { key } = configured();
  const { items } = z.object({ items: z.array(listedToolkit) }).parse(
    await request(key, 'toolkits/multi', 'POST', {
      toolkits: toolkit.options,
      limit: toolkit.options.length,
    }),
  );
  return toolkit.options.flatMap((slug) => {
    const item = items.find((value) => value.slug === slug);
    return item ? [{ slug, name: item.name, logo: item.meta.logo }] : [];
  });
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
      if (key.startsWith('uak_'))
        throw new Error('这是 Composio 用户密钥。请从 Project Settings → API Keys 复制项目密钥。');
      const user = saved()?.user ?? randomUUID();
      const query = new URLSearchParams({ user_ids: user, limit: '1' });
      await request(key, 'connected_accounts?' + query);
      const result = session.parse(
        await request(key, 'tool_router/session', 'POST', {
          user_id: user,
          toolkits: { enable: toolkit.options },
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
    catalog,
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
