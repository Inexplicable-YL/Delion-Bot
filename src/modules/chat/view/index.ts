import { lazy } from 'react';

export {
  agentClient,
  capabilitiesClient,
  chatClient,
  llmClient,
  onAgentEvent,
  onPermissionRequestOpened,
  onWebSearchChanged,
} from './client';
export { ArchivedSection } from './ArchivedSection';
export { ChatHome, type HomeChatRequest } from './ChatHome';
export { ChatTab } from './ChatTab';
export {
  ChatTabSourceProvider,
  type ChatTabSource,
  type ReferenceEntry,
  type ReferenceSource,
} from './ChatSource';
export { registerChatAttachmentCheck, saveChatDrafts, useChatDrafts } from './drafts';
export { referenceEntryCandidates } from './reference-tokens';
export { PermissionNotices } from './PermissionNotices';
export { FileTimeline } from './review/FileTimeline';
export { ProjectChanges, ProjectChangeTabStatus } from './review/ProjectChanges';
export { reviewTabTitle } from './review/tab-id';
export { runBadge, useRuns, useSessionRunStatus } from './runs';
export {
  exportSessionArchive,
  moveSession,
  refreshSessionLists,
  renameSession,
  updateSession,
  useSessions,
} from './sessions';

export const ReviewTab = lazy(() =>
  import('./review/ReviewTab').then((module) => ({ default: module.ReviewTab })),
);
