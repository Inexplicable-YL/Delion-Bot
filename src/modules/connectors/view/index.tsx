import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { SquaresPlusIcon as Blocks } from '@heroicons/react/24/outline';
import { defineView } from '../../../app/module';
import { errorMessage } from '../../../core/protocol/contract';
import { ErrorText } from '../../../ui/Alert';
import { McpTab, SectionHeader } from '../../settings/view';
import { providers } from '../contract';
import { ConnectorProvider } from './ConnectorProvider';
import {
  connectorStatusKey,
  connectorsClient as client,
  type ConnectorProvider as Provider,
  useConnectorAccounts,
  useConnectorCatalog,
  useConnectorStatus,
} from './use-connector-accounts';

export { ConnectedAppIcons, ConnectorAppIcon } from './ConnectorAppIcons';
export { useConnectorAccounts, useConnectorCatalog };
export { providerNames } from '../contract';
export type { ConnectorApp, ConnectorProvider } from './use-connector-accounts';

function Connectors() {
  const queryClient = useQueryClient();
  const status = useConnectorStatus();
  const [expanded, setExpanded] = useState<Partial<Record<Provider, boolean>>>({});
  const activate = useMutation({
    mutationFn: (next: Provider | null) => client.activate(next),
    onMutate: (next) => {
      queryClient.setQueryData<typeof status.data>(
        connectorStatusKey,
        (current) => current && { ...current, active: next },
      );
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: connectorStatusKey }),
  });
  const failure = status.error ?? activate.error;
  return (
    <div className="min-w-0 flex-1 overflow-y-auto bg-page">
      <div className="mx-auto grid w-full max-w-reading gap-10 px-app pt-app pb-8">
        <SectionHeader title="连接器" />
        {status.data &&
          providers.map((provider) => (
            <ConnectorProvider
              activating={activate.isPending}
              active={status.data.active === provider}
              configured={status.data.configured[provider]}
              key={provider}
              onActiveChange={(on) => {
                activate.mutate(on ? provider : null);
                if (on)
                  setExpanded(
                    Object.fromEntries(providers.map((item) => [item, item === provider])),
                  );
              }}
              onOpenChange={(open) => setExpanded({ ...expanded, [provider]: open })}
              open={expanded[provider] ?? status.data.active === provider}
              provider={provider}
            />
          ))}
        {failure && <ErrorText>{errorMessage(failure)}</ErrorText>}
        <McpTab />
      </div>
    </div>
  );
}
export const connectorsView = defineView({
  pages: {
    connectors: { component: Connectors, nav: { label: '连接器', icon: Blocks } },
  },
});
