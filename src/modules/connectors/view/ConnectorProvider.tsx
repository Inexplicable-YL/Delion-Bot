import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { errorMessage } from '../../../core/protocol/contract';
import { Button } from '../../../ui/Button';
import { cn } from '../../../ui/cn';
import { CollapsibleSection } from '../../../ui/Collapse';
import { ConfirmDialog } from '../../../ui/Dialog';
import { ErrorText } from '../../../ui/Alert';
import { Switch } from '../../../ui/Switch';
import { appCategories, featuredApps, providerNames, recommendedApps, toolkit } from '../contract';
import { ConnectorAppTile } from './ConnectorAppTile';
import { type AppCategory, ConnectorFilterBar } from './ConnectorFilterBar';
import { ProviderDialog } from './ProviderDialog';
import {
  authorizationPending,
  connectorAccountsKey,
  connectorsClient as client,
  type ConnectorAuthorization,
  type ConnectorProvider as Provider,
  useConnectorAccounts,
  useConnectorCatalog,
} from './use-connector-accounts';

export function ConnectorProvider({
  provider,
  configured,
  active,
  activating,
  open,
  onActiveChange,
  onOpenChange,
}: {
  provider: Provider;
  configured: boolean;
  active: boolean;
  activating: boolean;
  open: boolean;
  onActiveChange: (active: boolean) => void;
  onOpenChange: (open: boolean) => void;
}) {
  const name = providerNames[provider];
  const [configuring, setConfiguring] = useState(false);
  const [confirm, setConfirm] = useState<{ id: string; app: string; label: string } | null>(null);
  const [waiting, setWaiting] = useState<ConnectorAuthorization[]>([]);
  const queryClient = useQueryClient();
  const { accounts } = useConnectorAccounts(waiting, provider);
  const catalog = useConnectorCatalog(configured, provider);
  const connected = new Set(
    accounts.data?.filter((item) => item.status === 'ACTIVE').map((item) => item.toolkit.slug),
  );
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<AppCategory | null>(null);
  const keyword = query.trim().toLowerCase();
  const listed = (slugs: readonly (typeof toolkit.options)[number][]) =>
    slugs.flatMap((slug) => catalog.data?.filter((item) => item.slug === slug) ?? []);
  const filtered = (slugs: readonly (typeof toolkit.options)[number][]) =>
    listed(
      slugs.filter((slug) => category === null || featuredApps[slug].category === category),
    ).filter((item) =>
      `${item.name} ${featuredApps[item.slug].description}`.toLowerCase().includes(keyword),
    );
  const available = toolkit.options.filter((slug) => !connected.has(slug));
  const browsing = category === null && !keyword;
  const sections = [
    { title: 'Connected', apps: filtered(toolkit.options.filter((slug) => connected.has(slug))) },
    {
      title: 'Recommended',
      apps: browsing
        ? listed(
            [...new Set([...recommendedApps, ...toolkit.options])].filter((slug) =>
              available.includes(slug),
            ),
          ).slice(0, 6)
        : [],
    },
    ...appCategories.map((title) => ({
      title,
      apps: filtered(available.filter((slug) => featuredApps[slug].category === title)),
    })),
  ].filter((section) => section.apps.length > 0);
  const action = useMutation({ mutationFn: (run: () => Promise<void>) => run() });
  const busy = action.isPending;
  const failure = (confirm ? null : action.error) ?? accounts.error ?? catalog.error;
  const checkedAt = Math.max(accounts.dataUpdatedAt, accounts.errorUpdatedAt);
  const pending = waiting.filter((link) => authorizationPending(link, accounts.data, checkedAt));
  if (pending.length !== waiting.length) setWaiting(pending);
  const authorize = (slug: ConnectorAuthorization['slug']) => {
    const link = pending.find((value) => value.slug === slug);
    if (link && Date.now() < link.until) {
      window.open(link.url, '_blank', 'noopener');
      return;
    }
    action.mutate(async () => {
      const { redirect_url: url, connected_account_id: accountId } = await client.connect({
        provider,
        slug,
      });
      const known =
        accounts.data?.filter((item) => item.toolkit.slug === slug).map((item) => item.id) ?? [];
      const link = { slug, url, accountId, known, until: Date.now() + 600_000 };
      setWaiting((current) => [...current.filter((value) => value.slug !== slug), link]);
      window.open(url, '_blank', 'noopener');
    });
  };
  return (
    <section aria-label={name}>
      <CollapsibleSection
        action={
          <Switch
            checked={active}
            disabled={!configured || activating}
            label={`启用 ${name}`}
            onChange={onActiveChange}
          />
        }
        onOpenChange={onOpenChange}
        open={open}
        title={name}
      >
        <div className="grid gap-6 pt-2">
          <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2">
            <p className="text-ui-callout text-ink-2">
              {!configured
                ? `填入 ${name} 凭据后，即可连接 Gmail、GitHub 等应用。`
                : active && provider === 'composio'
                  ? '选择应用，在浏览器完成授权。也可以在聊天中要求 Agent 连接应用。'
                  : active
                    ? '选择应用，在浏览器完成授权。'
                    : `选择应用，在浏览器完成授权。启用 ${name} 后，Agent 才能使用这些应用。`}
            </p>
            {configured ? (
              <div className="flex shrink-0 gap-2">
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy}
                  onClick={() => accounts.refetch()}
                >
                  刷新账户
                </Button>
                <Button size="sm" variant="secondary" onClick={() => setConfiguring(true)}>
                  {provider === 'composio' ? '更换项目密钥' : '更换客户端凭据'}
                </Button>
              </div>
            ) : (
              <Button size="sm" variant="secondary" onClick={() => setConfiguring(true)}>
                配置 {name}
              </Button>
            )}
          </div>
          {configured && catalog.isPending && (
            <p className="text-ui-callout text-ink-2">正在读取应用目录…</p>
          )}
          {configured && catalog.isSuccess && (
            <ConnectorFilterBar
              category={category}
              onCategoryChange={setCategory}
              onQueryChange={setQuery}
              query={query}
            />
          )}
          {configured && catalog.isSuccess && sections.length === 0 && (
            <p className="text-ui-callout text-ink-2">没有匹配的应用。</p>
          )}
          {configured && catalog.isSuccess && sections.length > 0 && (
            <div className="grid gap-8">
              {sections.map((section, index) => (
                <section
                  aria-label={section.title}
                  className={cn(
                    'grid gap-2',
                    section.title === 'Connected' &&
                      index < sections.length - 1 &&
                      'border-b border-line pb-8',
                  )}
                  key={section.title}
                >
                  <h3 className="flex items-baseline gap-2 text-ui-headline text-ink">
                    {section.title}
                    {section.title === 'Connected' && (
                      <span className="text-ui-callout text-ink-3">{section.apps.length}</span>
                    )}
                  </h3>
                  <div className="grid gap-x-8 gap-y-1 sm:grid-cols-2">
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
            </div>
          )}
          {failure && <ErrorText>{errorMessage(failure)}</ErrorText>}
        </div>
      </CollapsibleSection>
      <ProviderDialog open={configuring} onOpenChange={setConfiguring} provider={provider} />
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
            await client.disconnect({ provider, id: confirm.id });
            queryClient.setQueryData<typeof accounts.data>(
              connectorAccountsKey(provider),
              (current) => current?.filter((account) => account.id !== confirm.id),
            );
            setConfirm(null);
            await accounts.refetch();
          });
        }}
      />
    </section>
  );
}
