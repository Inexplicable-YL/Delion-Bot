import { GlobeAltIcon, SquaresPlusIcon } from '@heroicons/react/24/outline';
import type { AgentToolResult } from '../../../core/protocol/agent';
import { Button } from '../../../ui/Button';
import { Popover, PopoverContent, PopoverTrigger } from '../../../ui/Popover';
import { menuItem } from '../../../ui/menu-styles';
import { ConnectorAppIcon, useConnectorCatalog } from '../../connectors/view';
import { isConnectorTool } from './connector-steps';
import { replySources, type ReplySource } from './reply-sources';

function SourceIcon({ source }: { source: ReplySource }) {
  if (source.logo) return <ConnectorAppIcon logo={source.logo} size="sm" />;
  const Icon = source.url ? GlobeAltIcon : SquaresPlusIcon;
  return (
    <span
      aria-hidden="true"
      className="grid size-badge shrink-0 place-items-center rounded-full border border-line bg-surface text-ink-2"
    >
      <Icon className="size-3.5" />
    </span>
  );
}

function SourceRow({ source }: { source: ReplySource }) {
  const Row = source.url ? 'a' : 'div';
  return (
    <li>
      <Row
        className={menuItem}
        {...(source.url && { href: source.url, rel: 'noopener noreferrer', target: '_blank' })}
      >
        <SourceIcon source={source} />
        <span className="min-w-0 flex-1 truncate">{source.title}</span>
        <span className="max-w-1/2 truncate text-ui-callout text-ink-2">{source.domain}</span>
      </Row>
    </li>
  );
}

export function ReplySources({ steps }: { steps: readonly AgentToolResult[] }) {
  const hasConnectors = steps.some(({ name }) => isConnectorTool(name));
  const catalog = useConnectorCatalog(hasConnectors).data ?? [];
  const sources = replySources(steps, catalog);
  if (!sources.length) return null;
  const label = sources.length === 1 ? sources[0]!.title : `${sources.length} 个来源`;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button className="min-w-0 shrink ps-1.5 pe-2" size="sm" variant="ghost">
          <span aria-hidden="true" className="flex shrink-0 items-center -space-x-2.5">
            {sources.slice(0, 3).map((source) => (
              <SourceIcon key={source.url ?? `${source.domain}:${source.title}`} source={source} />
            ))}
          </span>
          <span className="truncate">{label}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" aria-label="来源" className="w-inspector" side="top">
        <ul>
          {sources.map((source) => (
            <SourceRow key={source.url ?? `${source.domain}:${source.title}`} source={source} />
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
