import type { WorkspaceChat } from '../../../core/protocol/agent';
import type { WorkspaceEntry } from '../../workspace/contract';

export interface ComposerContext {
  projectId: string | null;
  remote: boolean;
}

export function composerContext(
  chat: WorkspaceChat | null,
  project: WorkspaceEntry | null,
  busy = false,
): ComposerContext | null {
  if (!chat || busy || chat.running || chat.messages.length > 0) return null;
  return {
    projectId: chat.projectId,
    remote: Boolean(project?.remoteId),
  };
}
