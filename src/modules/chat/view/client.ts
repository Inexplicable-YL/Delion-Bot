import { agentContract } from '../../../core/protocol/agent';
import { capabilitiesContract } from '../../../core/protocol/capabilities';
import { createClient, subscribe, type EventPayload } from '../../../core/protocol/contract';
import { llmContract } from '../../../core/protocol/llm';
import { chatContract } from '../contract';

const bridge = typeof window === 'undefined' ? undefined : window.delionBot?.bridge;

export const agentClient = createClient(agentContract, bridge);
export const chatClient = createClient(chatContract, bridge);
export const commandRepliesKey = (id: string) => ['chat', 'local-command-replies', id] as const;
export const llmClient = createClient(llmContract, bridge);
export const capabilitiesClient = createClient(capabilitiesContract, bridge);

export function onPermissionRequestsChanged(
  listener: (payload: EventPayload<typeof chatContract, 'permissionRequestsChanged'>) => void,
) {
  return subscribe(chatContract, bridge, 'permissionRequestsChanged', listener);
}

export function onPermissionRequestOpened(
  listener: (payload: EventPayload<typeof chatContract, 'permissionRequestOpened'>) => void,
) {
  return subscribe(chatContract, bridge, 'permissionRequestOpened', listener);
}

export function onCompactionChanged(
  listener: (payload: EventPayload<typeof chatContract, 'compactionChanged'>) => void,
) {
  return subscribe(chatContract, bridge, 'compactionChanged', listener);
}

export function onCompactionStream(
  listener: (payload: EventPayload<typeof chatContract, 'compactionStream'>) => void,
) {
  return subscribe(chatContract, bridge, 'compactionStream', listener);
}

export function onAgentEvent<K extends keyof (typeof agentContract)['events'] & string>(
  name: K,
  listener: (payload: EventPayload<typeof agentContract, K>) => void,
): () => void {
  return subscribe(agentContract, bridge, name, listener);
}

export function onWebSearchChanged(listener: () => void): () => void {
  return subscribe(capabilitiesContract, bridge, 'webSearchChanged', listener);
}
