import { createClient, subscribe, type EventPayload } from '../../../core/protocol/contract';
import { updateContract } from '../contract';

const bridge = typeof window === 'undefined' ? undefined : window.delionBot?.bridge;

export const updateClient = createClient(updateContract, bridge);

export function onUpdateEvent<K extends keyof (typeof updateContract)['events'] & string>(
  name: K,
  listener: (payload: EventPayload<typeof updateContract, K>) => void,
): () => void {
  return subscribe(updateContract, bridge, name, listener);
}
