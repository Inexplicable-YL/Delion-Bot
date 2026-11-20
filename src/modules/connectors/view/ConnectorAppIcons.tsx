import { cn } from '../../../ui/cn';
import { apps, toolkit } from '../contract';
import gmail from './assets/gmail.png';
import github from './assets/github.png';
import googleCalendar from './assets/google-calendar.png';
import googleDrive from './assets/google-drive.png';
import notion from './assets/notion.png';
import outlook from './assets/outlook.png';
import slack from './assets/slack.png';
import { useConnectorAccounts } from './use-connector-accounts';

const appIcons = {
  gmail,
  github,
  googlecalendar: googleCalendar,
  googledrive: googleDrive,
  notion,
  outlook,
  slack,
} satisfies Record<keyof typeof apps, string>;

export function ConnectorAppIcon({
  slug,
  size = 'md',
}: {
  slug: keyof typeof apps;
  size?: 'sm' | 'md';
}) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'grid shrink-0 place-items-center bg-on-media',
        size === 'sm'
          ? 'size-badge rounded-full border border-line'
          : 'size-8 rounded-control shadow-hairline',
      )}
    >
      <img
        alt=""
        className={cn('object-contain', size === 'sm' ? 'size-3.5' : 'size-5')}
        src={appIcons[slug]}
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
  const connected = toolkit.options.filter((slug) => active.has(slug));
  if (connected.length === 0) return null;

  const names = connected.map((slug) => apps[slug]).join('、');
  return (
    <span className="flex shrink-0 items-center -space-x-1.5" title={names}>
      <span className="sr-only">已连接应用 {names}</span>
      {connected.slice(0, 3).map((slug) => (
        <ConnectorAppIcon key={slug} size="sm" slug={slug} />
      ))}
    </span>
  );
}
