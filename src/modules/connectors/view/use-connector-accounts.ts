import { useQuery } from '@tanstack/react-query';
import type { infer as Infer } from 'zod';
import { createClient } from '../../../core/protocol/contract';
import {
  connectorsContract,
  type account,
  type app,
  type provider,
  type toolkit,
} from '../contract';

export const connectorsClient = createClient(connectorsContract, window.delionBot?.bridge);
export const connectorStatusKey = ['connectors', 'status'] as const;
export const connectorAccountsKey = (name: Infer<typeof provider> | undefined) =>
  ['connectors', name, 'accounts'] as const;

export type ConnectorApp = Infer<typeof app>;
export type ConnectorProvider = Infer<typeof provider>;

export type ConnectorAuthorization = {
  slug: Infer<typeof toolkit>;
  url: string;
  until: number;
  accountId?: string;
  known: readonly string[];
};

export function authorizationPending(
  waiting: ConnectorAuthorization,
  accounts: readonly Infer<typeof account>[] | undefined,
  checkedAt: number,
) {
  if (checkedAt >= waiting.until) return false;
  if (waiting.accountId === undefined)
    return !accounts?.some(
      (account) =>
        account.toolkit.slug === waiting.slug &&
        account.status === 'ACTIVE' &&
        !waiting.known.includes(account.id),
    );
  const status = accounts?.find((account) => account.id === waiting.accountId)?.status;
  return status === undefined || status === 'INITIALIZING' || status === 'INITIATED';
}

export function useConnectorStatus(enabled = true) {
  return useQuery({
    queryKey: connectorStatusKey,
    queryFn: () => connectorsClient.status(),
    enabled: enabled && Boolean(window.delionBot),
  });
}

export function useConnectorAccounts(
  waiting?: readonly ConnectorAuthorization[],
  name?: ConnectorProvider,
) {
  const status = useConnectorStatus();
  const provider = name ?? status.data?.active ?? undefined;
  const configured = provider !== undefined && status.data?.configured[provider] === true;
  const accounts = useQuery({
    queryKey: connectorAccountsKey(provider),
    queryFn: () => connectorsClient.accounts(provider!),
    enabled: configured,
    refetchOnWindowFocus: 'always',
    refetchInterval: waiting?.length ? 5000 : false,
  });
  return { status, provider, configured, accounts };
}

export function useConnectorCatalog(enabled: boolean, name?: ConnectorProvider) {
  const status = useConnectorStatus(enabled && name === undefined);
  const provider = name ?? status.data?.active ?? undefined;
  return useQuery({
    queryKey: ['connectors', provider, 'catalog'],
    queryFn: () => connectorsClient.catalog(provider!),
    enabled: enabled && provider !== undefined,
    staleTime: Infinity,
  });
}
