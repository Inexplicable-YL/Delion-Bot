import { useQuery } from '@tanstack/react-query';
import type { infer as Infer } from 'zod';
import { createClient } from '../../../core/protocol/contract';
import { connectorsContract, type account, type app, type toolkit } from '../contract';

export const connectorsClient = createClient(connectorsContract, window.delionBot?.bridge);

export type ConnectorApp = Infer<typeof app>;

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

/** 应用名称与图标很少变动，读一次后整个进程内复用；换密钥时随 connectors 前缀一起失效。 */
export function useConnectorCatalog(enabled: boolean) {
  return useQuery({
    queryKey: ['connectors', 'catalog'],
    queryFn: () => connectorsClient.catalog(),
    enabled,
    staleTime: Infinity,
  });
}
