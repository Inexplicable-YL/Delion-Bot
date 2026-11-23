import { createContext, useContext, type ComponentType, type ReactNode } from 'react';
import type { Navigate, Workbench } from '../../../app/module';

export type ReferenceEntry = { key: string; title: string };

export interface ReferenceSource {
  Entries: ComponentType<{
    projectId: string | null;
    cwd: string | null;
    children: (entries: ReferenceEntry[]) => ReactNode;
  }>;
  flushReference?(key: string): Promise<void>;
}

export interface ChatTabSource {
  navigate: Navigate;
  workbench: Workbench;
  opensLink(url: string): boolean;
  openReplyFile?(key: string, sessionId: string, projectId: string | null): void;
  revealWorkspaceFolder?(path: string, sessionId: string): Promise<void>;
  referenceSource?: ReferenceSource;
  onCreateProject?(): void;
  onSaveNote?(text: string): void;
}

const noEntries: ReferenceEntry[] = [];
export function NoReferenceEntries({
  children,
}: {
  children: (entries: ReferenceEntry[]) => ReactNode;
}) {
  return children(noEntries);
}

const detached: ChatTabSource = {
  navigate: () => false,
  workbench: { open: () => {}, openDocument: () => {}, close: () => {} },
  opensLink: () => false,
};

const ChatTabSourceContext = createContext<ChatTabSource>(detached);

export function ChatTabSourceProvider({
  source,
  children,
}: {
  source: ChatTabSource;
  children: ReactNode;
}) {
  return <ChatTabSourceContext.Provider value={source}>{children}</ChatTabSourceContext.Provider>;
}

export function useChatTabSource(): ChatTabSource {
  return useContext(ChatTabSourceContext);
}
