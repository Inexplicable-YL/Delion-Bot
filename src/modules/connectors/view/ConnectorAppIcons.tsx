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
        'grid shrink-0 place-items-center rounded-full border border-line bg-on-media',
        size === 'sm' ? 'size-5' : 'size-8',
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

export function ConnectorAppIcons() {
  const { accounts } = useConnectorAccounts();
  const active = new Set(
    accounts.data
      ?.filter((account) => account.status === 'ACTIVE')
      .map((account) => account.toolkit.slug),
  );
  const connected = toolkit.options.filter((slug) => active.has(slug));
  if (connected.length === 0) return null;

  const stacked = connected.length > 3;
  return (
    <span
      aria-hidden="true"
      className={cn('shrink-0 items-center', stacked ? 'grid w-16' : 'flex gap-0.5')}
      style={
        stacked
          ? { gridTemplateColumns: `repeat(${connected.length - 1}, minmax(0, 1fr)) auto` }
          : undefined
      }
      title={connected.map((slug) => apps[slug]).join('、')}
    >
      {connected.map((slug) => (
        <ConnectorAppIcon key={slug} slug={slug} size="sm" />
      ))}
    </span>
  );
}
