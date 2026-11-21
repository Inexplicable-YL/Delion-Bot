import { createContext, useContext, type ComponentType, type ReactNode } from 'react';
import type { Navigate, SourceDocumentProps } from '../../../app/module';
import type { DocumentContent, ResourceRef, TabId } from '../../workspace/contract';

export interface LoadedDocument {
  content: DocumentContent;
  source?: { id: string; document: ComponentType<SourceDocumentProps> };
  officeRef?: ResourceRef;
  watchesDisk?: boolean;
}

export interface ContentLoader {
  loadDocument(tabKey: TabId): Promise<LoadedDocument>;
  openLink(url: string): void;
  navigate: Navigate;
  onExported?(tabKey: TabId): void;
}

const ContentLoaderContext = createContext<ContentLoader | null>(null);

export function ContentLoaderProvider({
  loader,
  children,
}: {
  loader: ContentLoader;
  children: ReactNode;
}) {
  return <ContentLoaderContext.Provider value={loader}>{children}</ContentLoaderContext.Provider>;
}

export function useContentLoader(): ContentLoader {
  const loader = useContext(ContentLoaderContext);
  if (!loader) throw new Error('ContentLoaderProvider 未挂载');
  return loader;
}
