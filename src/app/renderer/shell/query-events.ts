import type { QueryClient } from '@tanstack/react-query';
import type { Bridge, Contract } from '../../../core/protocol/contract';

export function connectQueryEvents(
  client: QueryClient,
  contracts: Contract[],
  bridge: Bridge | undefined,
): void {
  if (!bridge) return;
  for (const contract of contracts)
    for (const name of Object.keys(contract.events)) {
      if (!(name in contract.procedures)) continue;
      const queryKey = [contract.namespace, name];
      bridge.subscribe(`${contract.namespace}:${name}`, (payload) => {
        if (payload !== undefined) {
          void client.cancelQueries({ queryKey, exact: true });
          client.setQueryData(queryKey, payload);
        }
        void client.invalidateQueries({
          queryKey,
          predicate: (query) => query.queryKey.length > 2,
        });
      });
    }
}
