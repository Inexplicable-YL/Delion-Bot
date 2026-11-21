import { useQuery } from '@tanstack/react-query';
import type { infer as Infer } from 'zod';
import { createClient } from '../../../core/protocol/contract';
import { connectorsContract, type account, type toolkit } from '../contract';

export const connectorsClient = createClient(connectorsContract, window.delionBot?.bridge);

export type ConnectorAuthorization = {
  slug: Infer<typeof toolkit>;
  url: string;
  until: number;
  previousAccounts: ReadonlySet<string>;
};

export function authorizationCompleted(
  waiting: ConnectorAuthorization,
  accounts: readonly Infer<typeof account>[] | undefined,
) {
  return accounts?.some(
    (account) =>
      account.toolkit.slug === waiting.slug &&
      account.status === 'ACTIVE' &&
      !waiting.previousAccounts.has(account.id),
  );
}

export function useConnectorAccounts(waiting?: readonly ConnectorAuthorization[], enabled = true) {
  const configured = useQuery({
    queryKey: ['connectors', 'configured'],
    queryFn: () => connectorsClient.configured(),
    enabled: enabled && Boolean(window.delionBot),
  });
  const accounts = useQuery({
    queryKey: ['connectors', 'accounts'],
    queryFn: () => connectorsClient.accounts(),
    enabled: enabled && configured.data === true,
    refetchOnWindowFocus: 'always',
    refetchInterval: (query) =>
      waiting?.some(
        (link) => Date.now() < link.until && !authorizationCompleted(link, query.state.data),
      )
        ? 5000
        : false,
  });
  return { configured, accounts };
}
