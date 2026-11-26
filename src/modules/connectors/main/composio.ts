import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { hostPorts } from '../../../core/ports';
import type { McpServerConfig } from '../../../core/protocol/capabilities';
import { account, authorization, toolkit } from '../contract';

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
class ToolkitNotAllowedError extends Error {}
class MissingAuthConfigsError extends Error {
  readonly toolkits: readonly string[];

  constructor(toolkits: readonly string[], details: string) {
    super(`请先在 Composio 项目中为 ${toolkits.join('、')} 创建并启用 Auth Config。${details}`);
    this.toolkits = toolkits;
  }
}

export function saved() {
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
    const badRequest =
      response.status === 400
        ? z
            .object({
              error: z.object({
                code: z.int().optional(),
                message: z.string().optional(),
                request_id: z.string().optional(),
              }),
            })
            .safeParse(await response.json().catch(() => null)).data?.error
        : undefined;
    const requestId = response.headers.get('x-request-id') ?? badRequest?.request_id;
    const trace =
      requestId &&
      (z.uuid().safeParse(requestId).success || /^req_[a-z0-9]{6,64}$/i.test(requestId))
        ? `请求编号 ${requestId}。`
        : '';
    if (response.status === 400) {
      const operation =
        path === 'tool_router/session'
          ? '创建会话'
          : path.endsWith('/link')
            ? '生成授权链接'
            : path.startsWith('toolkits')
              ? '读取应用目录'
              : method === 'DELETE'
                ? '断开账户'
                : '读取账户';
      const code = badRequest?.code === undefined ? '' : `错误代码 ${badRequest.code}。`;
      if (badRequest?.code === 4300 && path === 'tool_router/session') {
        const missing = badRequest.message?.match(
          /^The following toolkits require auth configs but none exist and cannot be auto-created: ([a-z0-9_]+(?:, [a-z0-9_]+)*)\. Please specify them in auth_configs\.$/,
        )?.[1];
        if (missing) {
          const slugs = missing.split(', ');
          const blocked = toolkit.options.filter((slug) => slugs.includes(slug));
          if (blocked.length) throw new MissingAuthConfigsError(blocked, code + trace);
        }
      }
      if (badRequest?.code === 4324 && path.endsWith('/link')) {
        throw new ToolkitNotAllowedError(
          `Composio 会话的允许列表缺少此应用（HTTP 400）。${code}${trace}`,
        );
      }
      throw new Error(`Composio 拒绝${operation}（HTTP 400）。${code}${trace}`);
    }
    if (response.status === 401 || response.status === 403) {
      const reason =
        path === 'tool_router/session'
          ? '项目密钥可以读取账户，但 Composio 拒绝创建会话。请为项目密钥启用 Session management 的写入权限。'
          : path.startsWith('toolkits')
            ? 'Composio 拒绝读取应用目录。请为项目密钥启用 Toolkits 的读取权限。'
            : path.endsWith('/link')
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
async function createSession(key: string, user: string, required?: z.infer<typeof toolkit>) {
  const create = async (allowed: readonly string[]) =>
    session.parse(
      await request(key, 'tool_router/session', 'POST', {
        user_id: user,
        toolkits: { enable: allowed },
        instant: false,
        manage_connections: { enable: true },
        workbench: { enable: false },
      }),
    );
  try {
    return await create(toolkit.options);
  } catch (error) {
    if (!(error instanceof MissingAuthConfigsError)) throw error;
    const allowed = toolkit.options.filter((slug) => !error.toolkits.includes(slug));
    if (!allowed.length || allowed.length === toolkit.options.length) throw error;
    if (required && !allowed.includes(required)) throw error;
    return create(allowed);
  }
}
export async function accounts() {
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
export async function catalog() {
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
export async function mcp(): Promise<McpServerConfig[]> {
  const value = saved();
  return value
    ? [
        {
          id: value.id,
          name: 'Composio',
          enabled: true,
          transport: 'http',
          url: value.session.mcp.url,
          headers: value.session.mcp.headers ?? { 'x-api-key': value.key },
        },
      ]
    : [];
}
export async function setup(key: string) {
  if (key.startsWith('uak_'))
    throw new Error('这是 Composio 用户密钥。请从 Project Settings → API Keys 复制项目密钥。');
  const user = saved()?.user ?? randomUUID();
  const query = new URLSearchParams({ user_ids: user, limit: '1' });
  await request(key, 'connected_accounts?' + query);
  const result = await createSession(key, user);
  hostPorts().secrets.write(
    'composio',
    JSON.stringify({ key, user, id: randomUUID(), session: result }),
  );
}
export async function connect(slug: z.infer<typeof toolkit>) {
  const value = configured();
  const createLink = async (sessionId: string) =>
    authorization.parse(
      await request(
        value.key,
        'tool_router/session/' + encodeURIComponent(sessionId) + '/link',
        'POST',
        { toolkit: slug },
      ),
    );
  try {
    return await createLink(value.session.session_id);
  } catch (error) {
    if (!(error instanceof ToolkitNotAllowedError)) throw error;
    const replacement = await createSession(value.key, value.user, slug);
    const link = await createLink(replacement.session_id);
    if (saved()?.id !== value.id) throw new Error('Composio 配置已更新，请重新连接。');
    hostPorts().secrets.write(
      'composio',
      JSON.stringify({ ...value, id: randomUUID(), session: replacement }),
    );
    return link;
  }
}
export async function disconnect(id: string) {
  const value = configured();
  if (!(await accounts()).some((item) => item.id === id)) throw new Error('未找到此账户。');
  await request(value.key, 'connected_accounts/' + encodeURIComponent(id), 'DELETE');
}
