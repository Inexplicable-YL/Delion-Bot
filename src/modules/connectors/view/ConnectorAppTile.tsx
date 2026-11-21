import { ChevronDownIcon } from '@heroicons/react/24/outline';
import type { infer as Infer } from 'zod';
import { Button } from '../../../ui/button';
import { cn } from '../../../ui/cn';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../../../ui/dropdown-menu';
import { featuredApps, type account, type app as appSchema, type toolkit } from '../contract';
import { ConnectorAppIcon } from './ConnectorAppIcons';

export function ConnectorAppTile({
  app,
  accounts,
  authorizing,
  busy,
  canAuthorize,
  onAuthorize,
  onDisconnect,
}: {
  app: Infer<typeof appSchema>;
  accounts: Infer<typeof account>[];
  authorizing: boolean;
  busy: boolean;
  canAuthorize: boolean;
  onAuthorize: (slug: Infer<typeof toolkit>) => void;
  onDisconnect: (id: string, label: string) => void;
}) {
  const active = accounts.filter((item) => item.status === 'ACTIVE').length;
  // 已连接的应用自成一类，行内不再重复状态；只有授权进行中需要提示。
  const waiting =
    active === 0 && (authorizing || accounts.some((item) => item.status === 'INITIATED'));
  const status = waiting
    ? { text: '等待授权', tone: 'text-ink-2' }
    : { text: featuredApps[app.slug].description, tone: 'text-ink-3' };
  return (
    <div aria-label={app.name} className="flex min-w-0 items-center gap-3 py-2" role="group">
      <ConnectorAppIcon logo={app.logo} />
      <div className="grid min-w-0 flex-1 gap-0.5">
        <span className="truncate text-ui-body text-ink">{app.name}</span>
        <span className={cn('truncate text-ui-callout', status.tone)} title={status.text}>
          {status.text}
        </span>
      </div>
      {accounts.length > 0 ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              aria-label={`管理 ${app.name} 账户`}
              disabled={busy}
              size="sm"
              variant="secondary"
            >
              管理
              <ChevronDownIcon />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {accounts.map((item, index) => {
              const label = item.alias?.trim() || `账户 ${index + 1}`;
              return (
                <DropdownMenuItem
                  key={item.id}
                  variant="destructive"
                  onSelect={() => onDisconnect(item.id, label)}
                >
                  断开 {label}
                </DropdownMenuItem>
              );
            })}
            <DropdownMenuSeparator />
            <DropdownMenuItem disabled={!canAuthorize} onSelect={() => onAuthorize(app.slug)}>
              {authorizing ? '打开授权页' : active > 0 ? '连接其他账户' : '重新授权'}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : (
        <Button
          disabled={!canAuthorize}
          onClick={() => onAuthorize(app.slug)}
          size="sm"
          variant="secondary"
        >
          {authorizing ? '打开授权页' : '连接'}
        </Button>
      )}
    </div>
  );
}
