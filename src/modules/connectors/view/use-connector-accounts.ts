import { useQuery } from '@tanstack/react-query';
import type { infer as Infer } from 'zod';
import { createClient } from '../../../core/protocol/contract';
import { connectorsContract, type account, type app, type toolkit } from '../contract';

export const connectorsClient = createClient(connectorsContract, window.delionBot?.bridge);
export const connectorAccountsKey = ['connectors', 'accounts'] as const;

export type ConnectorApp = Infer<typeof app>;

export type ConnectorAuthorization = {
  slug: Infer<typeof toolkit>;
  url: string;
  until: number;
  accountId: string;
};

export function authorizationPending(
  waiting: ConnectorAuthorization,
  accounts: readonly Infer<typeof account>[] | undefined,
  checkedAt: number,
) {
  const status = accounts?.find((account) => account.id === waiting.accountId)?.status;
  return (
    checkedAt < waiting.until &&
    (status === undefined || status === 'INITIALIZING' || status === 'INITIATED')
  );
}

export function useConnectorAccounts(waiting?: readonly ConnectorAuthorization[], enabled = true) {
  const configured = useQuery({
    queryKey: ['connectors', 'configured'],
    queryFn: () => connectorsClient.configured(),
    enabled: enabled && Boolean(window.delionBot),
  });
  const accounts = useQuery({
    queryKey: connectorAccountsKey,
    queryFn: () => connectorsClient.accounts(),
    enabled: enabled && configured.data === true,
    refetchOnWindowFocus: 'always',
    refetchInterval: waiting?.length ? 5000 : false,
  });
  return { configured, accounts };
}

export function useConnectorCatalog(enabled: boolean) {
  return useQuery({
    queryKey: ['connectors', 'catalog'],
    queryFn: () => connectorsClient.catalog(),
    enabled,
    staleTime: Infinity,
  });
}
