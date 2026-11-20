import { useQuery } from '@tanstack/react-query';
import { createClient } from '../../../core/protocol/contract';
import { connectorsContract } from '../contract';

export const connectorsClient = createClient(connectorsContract, window.delionBot?.bridge);

export function useConnectorAccounts(waiting?: { slug: string; until: number } | null) {
  const configured = useQuery({
    queryKey: ['connectors', 'configured'],
    queryFn: () => connectorsClient.configured(),
    enabled: Boolean(window.delionBot),
  });
  const accounts = useQuery({
    queryKey: ['connectors', 'accounts'],
    queryFn: () => connectorsClient.accounts(),
    enabled: configured.data === true,
    refetchOnWindowFocus: 'always',
    refetchInterval: (query) =>
      waiting &&
      Date.now() < waiting.until &&
      !query.state.data?.some(
        (account) => account.toolkit.slug === waiting.slug && account.status === 'ACTIVE',
      )
        ? 5000
        : false,
  });
  return { configured, accounts };
}
