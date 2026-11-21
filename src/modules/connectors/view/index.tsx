import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { SquaresPlusIcon as Blocks } from '@heroicons/react/24/outline';
import { defineView } from '../../../app/module';
import { errorMessage } from '../../../core/protocol/contract';
import { Button } from '../../../ui/button';
import { ConfirmDialog } from '../../../ui/dialog';
import { Input } from '../../../ui/input';
import { ErrorText } from '../../../ui/alert';
import { McpTab, SettingsGroup, SettingsGroupLabel, SectionHeader } from '../../settings/view';
import { appCategories, featuredApps, recommendedApps, toolkit } from '../contract';
import { ConnectorAppTile } from './ConnectorAppTile';
import {
  authorizationCompleted,
  connectorsClient as client,
  type ConnectorAuthorization,
  useConnectorAccounts,
  useConnectorCatalog,
} from './use-connector-accounts';

export { ConnectedAppIcons } from './ConnectorAppIcons';
export { useConnectorAccounts };

function Connectors() {
  const cache = useQueryClient();
  const [key, setKey] = useState('');
  const [editing, setEditing] = useState(false);
  const [confirm, setConfirm] = useState<{ id: string; app: string; label: string } | null>(null);
  const [waiting, setWaiting] = useState<ConnectorAuthorization[]>([]);
  const { configured, accounts } = useConnectorAccounts(waiting);
  const catalog = useConnectorCatalog(configured.data === true);
  const listed = (slugs: readonly string[]) =>
    catalog.data?.filter((item) => slugs.includes(item.slug)) ?? [];
  const sections = [
    { title: '推荐', apps: listed(recommendedApps) },
    ...appCategories.map((category) => ({
      title: category,
      apps: listed(toolkit.options.filter((slug) => featuredApps[slug].category === category)),
    })),
  ];
  const setup = useMutation({
    mutationFn: () => client.setup(key),
    onSuccess: async () => {
      setKey('');
      setEditing(false);
      await cache.invalidateQueries({ queryKey: ['connectors'] });
    },
  });
  const action = useMutation({ mutationFn: (run: () => Promise<void>) => run() });
  const busy = action.isPending || setup.isPending;
  const failure =
    (confirm ? null : action.error) ?? configured.error ?? accounts.error ?? catalog.error;
  const pending = waiting.filter((link) => !authorizationCompleted(link, accounts.data));
  if (pending.length !== waiting.length) setWaiting(pending);
  const authorize = (slug: ConnectorAuthorization['slug']) => {
    const link = pending.find((value) => value.slug === slug);
    if (link && Date.now() < link.until) {
      window.open(link.url, '_blank', 'noopener');
      return;
    }
    const previousAccounts = new Set(
      accounts.data
        ?.filter((account) => account.toolkit.slug === slug && account.status === 'ACTIVE')
        .map((account) => account.id),
    );
    action.mutate(async () => {
      const url = await client.connect(slug);
      const link = { slug, url, previousAccounts, until: Date.now() + 600_000 };
      setWaiting((current) => [...current.filter((value) => value.slug !== slug), link]);
      window.open(url, '_blank', 'noopener');
    });
  };
  return (
    <div className="min-w-0 flex-1 overflow-y-auto bg-page">
      <div className="mx-auto grid w-full max-w-reading gap-app-gap p-app">
        <SectionHeader title="连接器" />
        {configured.data !== undefined && (!configured.data || editing) ? (
          <SettingsGroup
            title="连接 Composio"
            description="在 Composio 的 Project Settings → API Keys 获取项目密钥。"
          >
            <form
              className="grid gap-3 py-3"
              onSubmit={(e) => {
                e.preventDefault();
                if (!busy && key.trim()) setup.mutate();
              }}
            >
              <a
                className="text-ui-body underline"
                href="https://dashboard.composio.dev/"
                target="_blank"
                rel="noreferrer"
              >
                前往 Composio 获取项目密钥 ↗
              </a>
              <Input
                type="password"
                aria-label="Composio 项目密钥"
                aria-invalid={setup.isError || undefined}
                aria-describedby={setup.isError ? 'composio-setup-error' : undefined}
                autoComplete="off"
                placeholder="粘贴项目 API Key"
                value={key}
                disabled={setup.isPending}
                onChange={(e) => {
                  setKey(e.target.value);
                  if (setup.isError) setup.reset();
                }}
              />
              {setup.error && (
                <ErrorText id="composio-setup-error" size="sm">
                  {errorMessage(setup.error)}
                </ErrorText>
              )}
              <details className="text-ui-subhead text-ink-2">
                <summary className="cursor-pointer">受限项目密钥需要哪些权限？</summary>
                <ul className="grid gap-1 py-2">
                  <li>Session management · Write only</li>
                  <li>Session tool execution · Write only</li>
                  <li>Connected accounts · Read and write</li>
                  <li>Toolkits · Read only</li>
                </ul>
              </details>
              <div>
                <Button disabled={busy || !key.trim()} type="submit" variant="accent">
                  {setup.isPending ? '正在验证…' : '验证并保存'}
                </Button>{' '}
                {editing && (
                  <Button
                    type="button"
                    variant="ghost"
                    disabled={setup.isPending}
                    onClick={() => {
                      setKey('');
                      setup.reset();
                      setEditing(false);
                    }}
                  >
                    取消
                  </Button>
                )}
              </div>
            </form>
          </SettingsGroup>
        ) : null}
        {configured.data && (
          <section className="grid gap-app-gap">
            <SettingsGroupLabel
              title="应用"
              description="选择应用，在浏览器完成授权。也可以在聊天中要求 Agent 连接应用。"
              action={
                <div className="flex gap-2">
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
              }
            />
            {catalog.isPending && <p className="text-ui-callout text-ink-2">正在读取应用目录…</p>}
            {catalog.isSuccess &&
              sections.map((section) => (
                <section aria-label={section.title} className="grid gap-1" key={section.title}>
                  <h3 className="text-ui-headline text-ink">{section.title}</h3>
                  <div className="grid gap-x-8 sm:grid-cols-2">
                    {section.apps.map((item) => (
                      <ConnectorAppTile
                        accounts={
                          accounts.data?.filter((account) => account.toolkit.slug === item.slug) ??
                          []
                        }
                        app={item}
                        authorizing={pending.some((link) => link.slug === item.slug)}
                        busy={busy}
                        canAuthorize={!busy && !accounts.isLoading}
                        key={item.slug}
                        onAuthorize={authorize}
                        onDisconnect={(id, label) => {
                          action.reset();
                          setConfirm({ id, app: item.name, label });
                        }}
                      />
                    ))}
                  </div>
                </section>
              ))}
          </section>
        )}
        {failure && <ErrorText>{errorMessage(failure)}</ErrorText>}
        <ConfirmDialog
          open={confirm !== null}
          onOpenChange={(open) => !open && !busy && setConfirm(null)}
          title="断开账户？"
          description={
            confirm ? (
              <>
                断开 {confirm.app} 的「{confirm.label}」后，需重新授权才能使用该账户。
                {action.error && (
                  <span className="mt-2 block text-danger">{errorMessage(action.error)}</span>
                )}
              </>
            ) : (
              ''
            )
          }
          confirmLabel="断开账户"
          destructive
          busy={busy}
          onConfirm={() => {
            if (!confirm) return;
            action.mutate(async () => {
              await client.disconnect(confirm.id);
              setConfirm(null);
              await accounts.refetch();
            });
          }}
        />
        <details>
          <summary className="cursor-pointer text-ui-headline">自定义 MCP 服务器</summary>
          <div className="pt-4">
            <McpTab />
          </div>
        </details>
      </div>
    </div>
  );
}
export const connectorsView = defineView({
  pages: {
    connectors: { component: Connectors, nav: { label: '连接器', icon: Blocks } },
  },
});
