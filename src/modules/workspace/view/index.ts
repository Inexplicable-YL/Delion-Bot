export {
  draggedEntryIds,
  Explorer,
  explorerDragType,
  type ExplorerItem,
  type ExplorerPending,
} from './Explorer';
export { onWorkspaceEvent, workspaceClient } from './client';
export { DownloadFileButton } from './DownloadFileButton';
export { fileIconUrl } from './file-icons';
export { useWorkspaceStore } from './store';
export { isChatStoragePath, workspaceEntryPath } from './entry-path';

export function localPathsOf(files: File[]): string[] {
  return files.map((file) => window.delionBot?.pathForFile(file) ?? '').filter(Boolean);
}
