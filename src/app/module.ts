import type { Implementation } from '../core/protocol/contract';
import type { QueryClient } from '@tanstack/react-query';
import type { ComponentType } from 'react';
import type { DocumentContent, ResourceRef, TabId } from '../modules/workspace/contract';

export type { TabId };

export interface NavTargets {}

export type NavTarget = {
  [Page in keyof NavTargets]: { page: Page } & NavTargets[Page];
}[keyof NavTargets];

export interface ModuleDefinition {
  id: string;
  ipc?: Implementation;
  register?(): void;
  start?(): (() => void) | void;
  openLink?(url: string): boolean;
}

export function defineModule(definition: ModuleDefinition): ModuleDefinition {
  return definition;
}

export type Navigate = (target: NavTarget) => boolean;

export interface Workbench {
  open(tab: TabId, options?: { aside?: boolean }): void;
  openDocument(key: string, options?: { aside?: boolean }): void;
  close(tab: TabId): void;
}

export interface PageDrawer {
  container: HTMLElement;
  close(): void;
}

export interface PageDefinition<Page extends keyof NavTargets> {
  component: ComponentType<{
    target: NavTargets[Page];
    navigate: Navigate;
    drawer: PageDrawer | null;
  }>;
  drawer?: boolean;
  nav?: { label: string; icon: ComponentType<{ className?: string; strokeWidth?: number }> };
  open?(target: NavTargets[Page]): void;
}

export interface ViewDefinition {
  pages: { [Page in keyof NavTargets]?: PageDefinition<Page> };
  notices?: Record<string, NoticeKind>;
  start?(navigate: Navigate): void;
  settings?: {
    credentials?: ComponentType<{ navigate: Navigate }>;
    storage?: ComponentType;
  };
  onboarding?: ComponentType<{ onDone: () => void }>;
  sources?: SourceDefinition;
  leaveGuard?(proceed: () => void): boolean;
  opensLink?(url: string): boolean;
  sourceTitle?(sourceId: string, client: QueryClient): string | undefined;
  sourceOfLink?(url: string, client: QueryClient): string | undefined;
  officeRef?(sourceId: string): ResourceRef | undefined;
}

export interface SourceDefinition {
  prefix: string;
  icon: ComponentType<{ className?: string; strokeWidth?: number }>;
  badge?: ComponentType<{ sourceId: string }>;
  document?: ComponentType<SourceDocumentProps>;
}

export interface SourceDocumentProps {
  sourceId: string;
  content: DocumentContent;
  navigate: Navigate;
  onReload: () => void;
}

export interface NoticeKind {
  label: string;
  icon: ComponentType<{ className?: string }>;
}

export function defineView(definition: ViewDefinition): ViewDefinition {
  return definition;
}
