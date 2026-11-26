import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { invalidateSessions } from '../../../core/agent/session/run';
import type { ManagedMcpServerConfig } from '../../../core/capabilities/mcp';
import { hostPorts } from '../../../core/ports';
import { credentials, pipedreamApps, toolkit, type account } from '../contract';

const config = z.object({
  clientId: z.string(),
  clientSecret: z.string(),
  projectId: z.string(),
  user: z.string(),
  id: z.uuid(),
  apps: z.array(toolkit),
});
type Config = z.infer<typeof config>;
const listedApp = z.object({ name_slug: z.string(), name: z.string(), img_src: z.string() });
const listedAccount = z.object({
  id: z.string(),
  name: z.string().nullish(),
  healthy: z.boolean().nullish(),
  dead: z.boolean().nullish(),
  app: listedApp,
});
const issuedToken = z.object({ access_token: z.string(), expires_in: z.number() });
const toolkitOf = Object.fromEntries(
  Object.entries(pipedreamApps).map(([slug, pipedreamSlug]) => [pipedreamSlug, slug]),
) as Record<string, z.infer<typeof toolkit>>;

type AccessToken = { config: string; value: string; id: string };
let token: AccessToken | null = null;
let issuing: { config: string; promise: Promise<AccessToken> } | null = null;

export function saved() {
  const raw = hostPorts().secrets.read('pipedream');
  return raw ? config.parse(JSON.parse(raw)) : null;
}
function configured() {
  const value = saved();
  if (!value) throw new Error('请先配置 Pipedream 客户端凭据。');
  return value;
}
function failure(response: Response, operation: string) {
  if (response.status === 401 || response.status === 403)
    return new Error(
      `Pipedream 拒绝${operation}。请检查 OAuth 客户端的 Client ID、Client Secret，以及它是否属于该项目（HTTP ${response.status}）。`,
    );
  if (response.status === 404 && operation !== '读取应用目录')
    return new Error(`Pipedream 未找到该项目，请检查项目 ID（HTTP 404）。`);
  if (response.status === 429) return new Error('Pipedream 请求过于频繁，请稍后重试（HTTP 429）。');
  return new Error(`Pipedream ${operation}失败（HTTP ${response.status}），请稍后重试。`);
}
async function issueToken(value: Pick<Config, 'clientId' | 'clientSecret'>) {
  const response = await hostPorts().network.fetch('https://api.pipedream.com/v1/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'client_credentials',
      client_id: value.clientId,
      client_secret: value.clientSecret,
    }),
    signal: AbortSignal.timeout(20000),
  });
  if (!response.ok) throw failure(response, '签发访问令牌');
  return issuedToken.parse(await response.json());
}
function remember(configId: string, issued: z.infer<typeof issuedToken>) {
  const current: AccessToken = { config: configId, value: issued.access_token, id: randomUUID() };
  token = current;
  setTimeout(
    () => {
      if (token !== current) return;
      token = null;
      invalidateSessions();
    },
    Math.max(issued.expires_in - 600, 60) * 1000,
  ).unref();
  return current;
}
async function accessToken(value: Config) {
  if (token?.config === value.id) return token;
  if (issuing?.config === value.id) return issuing.promise;
  const promise = issueToken(value)
    .then((issued) => remember(value.id, issued))
    .finally(() => {
      if (issuing?.promise === promise) issuing = null;
    });
  issuing = { config: value.id, promise };
  return promise;
}
async function request(
  value: Pick<Config, 'projectId'>,
  bearer: string,
  path: string,
  operation: string,
  init: { method?: string; body?: unknown } = {},
) {
  const response = await hostPorts().network.fetch('https://api.pipedream.com/v1/' + path, {
    method: init.method ?? 'GET',
    headers: {
      Authorization: `Bearer ${bearer}`,
      'Content-Type': 'application/json',
      'x-pd-environment': 'production',
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    signal: AbortSignal.timeout(20000),
  });
  if (!response.ok) throw failure(response, operation);
  return init.method === 'DELETE' ? null : response.json();
}
async function listAccounts(value: Pick<Config, 'projectId' | 'user'>, bearer: string) {
  const items: z.infer<typeof listedAccount>[] = [];
  let cursor: string | null = null;
  do {
    const query = new URLSearchParams({ external_user_id: value.user, limit: '100' });
    if (cursor) query.set('after', cursor);
    const page = z
      .object({
        data: z.array(listedAccount),
        page_info: z.object({ end_cursor: z.string().nullish() }),
      })
      .parse(
        await request(value, bearer, `connect/${value.projectId}/accounts?${query}`, '读取账户'),
      );
    items.push(...page.data);
    cursor = page.data.length ? (page.page_info.end_cursor ?? null) : null;
  } while (cursor);
  return items;
}
function summary(item: z.infer<typeof listedAccount>): z.infer<typeof account> {
  return {
    id: item.id,
    alias: item.name,
    toolkit: { slug: toolkitOf[item.app.name_slug] ?? item.app.name_slug },
    status: item.dead ? 'EXPIRED' : item.healthy === false ? 'INACTIVE' : 'ACTIVE',
  };
}
function connectedApps(items: z.infer<typeof account>[]) {
  return toolkit.options.filter((slug) =>
    items.some((item) => item.status === 'ACTIVE' && item.toolkit.slug === slug),
  );
}
export async function setup(
  input: Extract<z.infer<typeof credentials>, { provider: 'pipedream' }>,
) {
  const user = saved()?.user ?? randomUUID();
  const issued = await issueToken(input);
  const items = (await listAccounts({ projectId: input.projectId, user }, issued.access_token)).map(
    summary,
  );
  const value: Config = {
    clientId: input.clientId,
    clientSecret: input.clientSecret,
    projectId: input.projectId,
    user,
    id: randomUUID(),
    apps: connectedApps(items),
  };
  hostPorts().secrets.write('pipedream', JSON.stringify(value));
  remember(value.id, issued);
}
export async function accounts() {
  const value = configured();
  const items = (await listAccounts(value, (await accessToken(value)).value)).map(summary);
  const apps = connectedApps(items);
  const current = saved();
  if (current?.id === value.id && apps.join() !== current.apps.join()) {
    hostPorts().secrets.write('pipedream', JSON.stringify({ ...current, apps }));
    invalidateSessions();
  }
  return items;
}
export async function catalog() {
  const value = configured();
  const bearer = (await accessToken(value)).value;
  const apps = await Promise.all(
    toolkit.options.map(async (slug) => {
      const response = await hostPorts().network.fetch(
        'https://api.pipedream.com/v1/connect/apps/' + pipedreamApps[slug],
        {
          headers: { Authorization: `Bearer ${bearer}`, 'x-pd-environment': 'production' },
          signal: AbortSignal.timeout(20000),
        },
      );
      if (response.status === 404) return [];
      if (!response.ok) throw failure(response, '读取应用目录');
      const { data } = z.object({ data: listedApp }).parse(await response.json());
      return [{ slug, name: data.name, logo: data.img_src }];
    }),
  );
  return apps.flat();
}
export async function connect(slug: z.infer<typeof toolkit>) {
  const value = configured();
  const { connect_link_url } = z
    .object({ connect_link_url: z.url({ protocol: /^https$/ }) })
    .parse(
      await request(
        value,
        (await accessToken(value)).value,
        `connect/${value.projectId}/tokens`,
        '生成授权链接',
        { method: 'POST', body: { external_user_id: value.user } },
      ),
    );
  const link = new URL(connect_link_url);
  link.searchParams.set('app', pipedreamApps[slug]);
  return { redirect_url: link.href };
}
export async function disconnect(id: string) {
  const value = configured();
  const bearer = (await accessToken(value)).value;
  if (!(await listAccounts(value, bearer)).some((item) => item.id === id))
    throw new Error('未找到此账户。');
  await request(
    value,
    bearer,
    `connect/${value.projectId}/accounts/${encodeURIComponent(id)}`,
    '断开账户',
    { method: 'DELETE' },
  );
}
export async function mcp(): Promise<ManagedMcpServerConfig[]> {
  const value = saved();
  if (!value?.apps.length) return [];
  const current = await accessToken(value);
  return value.apps.map((slug) => ({
    id: `${current.id}-${slug}`,
    approvalId: `${value.id}-${slug}`,
    name: `Pipedream ${slug}`,
    enabled: true,
    transport: 'http',
    url: 'https://remote.mcp.pipedream.net/v3',
    headers: {
      Authorization: `Bearer ${current.value}`,
      'x-pd-project-id': value.projectId,
      'x-pd-environment': 'production',
      'x-pd-external-user-id': value.user,
      'x-pd-app-slug': pipedreamApps[slug],
    },
  }));
}
