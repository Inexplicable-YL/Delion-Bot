import { agentContract } from '../../../core/protocol/agent';
import { capabilitiesContract } from '../../../core/protocol/capabilities';
import { createClient, subscribe, type EventPayload } from '../../../core/protocol/contract';
import { llmContract } from '../../../core/protocol/llm';
import { chatContract } from '../contract';

const bridge = typeof window === 'undefined' ? undefined : window.delionBot?.bridge;

export const agentClient = createClient(agentContract, bridge);
export const chatClient = createClient(chatContract, bridge);
export const llmClient = createClient(llmContract, bridge);
export const capabilitiesClient = createClient(capabilitiesContract, bridge);

export function onAgentEvent<K extends keyof (typeof agentContract)['events'] & string>(
  name: K,
  listener: (payload: EventPayload<typeof agentContract, K>) => void,
): () => void {
  return subscribe(agentContract, bridge, name, listener);
}

export function onWebSearchChanged(listener: () => void): () => void {
  return subscribe(capabilitiesContract, bridge, 'webSearchChanged', listener);
}
