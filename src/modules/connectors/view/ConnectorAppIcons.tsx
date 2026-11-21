import { cn } from '../../../ui/cn';
import { useConnectorAccounts, useConnectorCatalog } from './use-connector-accounts';

export function ConnectorAppIcon({ logo, size = 'md' }: { logo: string; size?: 'sm' | 'md' }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'grid shrink-0 place-items-center bg-on-media',
        size === 'sm'
          ? 'size-badge rounded-full border border-line'
          : 'size-10 rounded-control border border-line',
      )}
    >
      <img
        alt=""
        className={cn('object-contain', size === 'sm' ? 'size-3.5' : 'size-6')}
        loading="lazy"
        src={logo}
      />
    </span>
  );
}

export function ConnectedAppIcons() {
  const { accounts } = useConnectorAccounts();
  const active = new Set(
    accounts.data
      ?.filter((account) => account.status === 'ACTIVE')
      .map((account) => account.toolkit.slug),
  );
  const catalog = useConnectorCatalog(active.size > 0);
  const connected = catalog.data?.filter((app) => active.has(app.slug)) ?? [];
  if (connected.length === 0) return null;

  const names = connected.map((app) => app.name).join('、');
  return (
    <span className="flex shrink-0 items-center -space-x-1.5" title={names}>
      <span className="sr-only">已连接应用 {names}</span>
      {connected.slice(0, 3).map((app) => (
        <ConnectorAppIcon key={app.slug} logo={app.logo} size="sm" />
      ))}
    </span>
  );
}
