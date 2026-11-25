import { agentContract } from '../core/protocol/agent';
import { capabilitiesContract } from '../core/protocol/capabilities';
import type { Contract } from '../core/protocol/contract';
import { llmContract } from '../core/protocol/llm';
import { chatContract } from '../modules/chat/contract';
import { connectorsContract } from '../modules/connectors/contract';
import { noteContract } from '../modules/note/contract';
import { notificationsContract } from '../modules/notifications/contract';
import { onboardingContract } from '../modules/onboarding/contract';
import { remotesContract } from '../modules/remotes/contract';
import { searchContract } from '../modules/search/contract';
import { settingsContract } from '../modules/settings/contract';
import { terminalContract } from '../modules/terminal/contract';
import { todoContract } from '../modules/todo/contract';
import { updateContract } from '../modules/update/contract';
import { workspaceContract } from '../modules/workspace/contract';

export const contracts: Contract[] = [
  agentContract,
  llmContract,
  capabilitiesContract,
  workspaceContract,
  noteContract,
  remotesContract,
  terminalContract,
  chatContract,
  connectorsContract,
  settingsContract,
  updateContract,
  onboardingContract,
  searchContract,
  todoContract,
  notificationsContract,
];
