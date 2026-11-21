import { createClient } from '../../../core/protocol/contract';
import { settingsContract } from '../contract';

const bridge = typeof window === 'undefined' ? undefined : window.delionBot?.bridge;

export const settingsClient = createClient(settingsContract, bridge);
