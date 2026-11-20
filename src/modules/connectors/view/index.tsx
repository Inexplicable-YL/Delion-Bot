import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Blocks } from 'lucide-react';
import { defineView } from '../../../app/module';
import { createClient, errorMessage } from '../../../core/protocol/contract';
import { Button } from '../../../ui/button';
import { Input } from '../../../ui/input';
import { ErrorText } from '../../../ui/alert';
import { McpTab, SettingsGroup, SectionHeader, SettingRow } from '../../settings/view';
import { apps, connectorsContract, toolkit } from '../contract';
const client = createClient(connectorsContract, window.delionBot?.bridge);
function Connectors() {
  const cache = useQueryClient();
  const [key, setKey] = useState('');
  const [editing, setEditing] = useState(false);
  const [confirm, setConfirm] = useState<string | null>(null);
  const [waiting, setWaiting] = useState<{ slug: string; until: number } | null>(null);
  const configured = useQuery({
    queryKey: ['connectors', 'configured'],
    queryFn: () => client.configured(),
  });
  const accounts = useQuery({
    queryKey: ['connectors', 'accounts'],
    queryFn: () => client.accounts(),
    enabled: configured.data === true,
    refetchOnWindowFocus: 'always',
    refetchInterval: (q) =>
      waiting &&
      Date.now() < waiting.until &&
      !q.state.data?.some((a) => a.toolkit.slug === waiting.slug && a.status === 'ACTIVE')
        ? 5000
        : false,
  });
  const action = useMutation({ mutationFn: (run: () => Promise<void>) => run() });
  const busy = action.isPending;
  const failure = action.error ?? configured.error ?? accounts.error;
  return (
    <main className="min-w-0 flex-1 overflow-y-auto bg-surface">
      <div className="mx-auto grid w-full max-w-228 gap-8 px-4 py-6 md:px-10">
        <SectionHeader title="连接器" />
        {configured.data !== undefined && (!configured.data || editing) ? (
          <SettingsGroup
            title="连接 Composio"
            description="在 Composio 的 Settings → API Keys 获取项目密钥。完成一次配置后，即可连接下方应用。"
          >
            <form
              className="grid gap-3 py-3"
              onSubmit={(e) => {
                e.preventDefault();
                action.mutate(async () => {
                  await client.setup(key);
                  setKey('');
                  setEditing(false);
                  await cache.invalidateQueries({ queryKey: ['connectors'] });
                });
              }}
            >
              <a
                className="text-sm underline"
                href="https://dashboard.composio.dev/"
                target="_blank"
                rel="noreferrer"
              >
                前往 Composio 获取项目密钥 ↗
              </a>
              <Input
                type="password"
                aria-label="Composio 项目密钥"
                placeholder="粘贴项目 API Key"
                value={key}
                onChange={(e) => setKey(e.target.value)}
              />
              <div>
                <Button disabled={busy || !key.trim()} type="submit">
                  {busy ? '正在验证…' : '验证并保存'}
                </Button>{' '}
                {editing && (
                  <Button type="button" variant="ghost" onClick={() => setEditing(false)}>
                    取消
                  </Button>
                )}
              </div>
            </form>
          </SettingsGroup>
        ) : null}
        {configured.data !== undefined && (
          <SettingsGroup
            title="应用"
            description="选择应用，在浏览器完成授权。也可以在聊天中要求 Agent 连接应用。"
          >
            {toolkit.options.map((slug) => {
              const items = accounts.data?.filter((a) => a.toolkit.slug === slug) ?? [];
              return (
                <SettingRow settingId={slug} key={slug} title={apps[slug]}>
                  <div className="flex flex-wrap items-center gap-2">
                    {items.map((a) => (
                      <span key={a.id} className="inline-flex items-center gap-2 text-sm">
                        {[
                          a.alias,
                          a.status === 'ACTIVE'
                            ? '已连接'
                            : a.status === 'INITIATED'
                              ? '等待授权'
                              : a.status,
                        ]
                          .filter(Boolean)
                          .join(' · ')}{' '}
                        <Button
                          disabled={busy}
                          size="sm"
                          variant="ghost"
                          onClick={() =>
                            confirm === a.id
                              ? action.mutate(async () => {
                                  await client.disconnect(a.id);
                                  setConfirm(null);
                                  setWaiting(null);
                                  await accounts.refetch();
                                })
                              : setConfirm(a.id)
                          }
                        >
                          {confirm === a.id ? '确认断开' : '断开'}
                        </Button>
                        {confirm === a.id && (
                          <Button size="sm" variant="ghost" onClick={() => setConfirm(null)}>
                            取消
                          </Button>
                        )}
                      </span>
                    ))}
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={busy || !configured.data || accounts.isLoading}
                      onClick={() =>
                        action.mutate(async () => {
                          const url = await client.connect(slug);
                          window.open(url, '_blank', 'noopener');
                          setWaiting({ slug, until: Date.now() + 600000 });
                        })
                      }
                    >
                      {items.length
                        ? '重新授权'
                        : waiting?.slug === slug
                          ? '再次打开授权页'
                          : '连接'}
                    </Button>
                  </div>
                </SettingRow>
              );
            })}
            {configured.data && (
              <div className="flex gap-2 py-2">
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy}
                  onClick={() => accounts.refetch()}
                >
                  刷新账户
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>
                  更换项目密钥
                </Button>
              </div>
            )}
          </SettingsGroup>
        )}
        {failure && <ErrorText>{errorMessage(failure)}</ErrorText>}
        <details>
          <summary className="cursor-pointer text-sm font-medium">自定义 MCP 服务器</summary>
          <div className="pt-4">
            <McpTab />
          </div>
        </details>
      </div>
    </main>
  );
}
export const connectorsView = defineView({
  pages: { connectors: { component: Connectors, nav: { label: '连接器', icon: Blocks } } },
});
