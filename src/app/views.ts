import type { QueryClient } from '@tanstack/react-query';
import type { ComponentType } from 'react';
import type {
  NavTarget,
  NavTargets,
  Navigate,
  PageDefinition,
  PageDrawer,
  SourceDefinition,
  ViewDefinition,
} from './module';
import type { ResourceRef } from '../modules/workspace/contract';
import { connectorsView } from '../modules/connectors/view';
import { notificationsView } from '../modules/notifications/view';
import { todoView } from '../modules/todo/view';
import { updateView } from '../modules/update/view';

const moduleViews = [connectorsView, todoView];

export const views: ViewDefinition[] = [
  ...moduleViews,
  notificationsView(Object.assign({}, ...moduleViews.map((view) => view.notices))),
  updateView,
];

interface AnyPage {
  component: ComponentType<{ target: NavTarget; navigate: Navigate; drawer: PageDrawer | null }>;
  drawer?: boolean;
  open?(target: NavTarget): void;
}

const pages = new Map(
  views.flatMap((view) => Object.entries(view.pages) as Array<[string, AnyPage]>),
);

export const navPages = views.flatMap((view) =>
  (Object.entries(view.pages) as Array<[keyof NavTargets, PageDefinition<keyof NavTargets>]>)
    .filter(([, page]) => page.nav)
    .map(([id, page]) => ({ id, ...page.nav! })),
);

export function pageOf(page: string): AnyPage | undefined {
  return pages.get(page);
}

export function pageHasDrawer(page: string): boolean {
  return pages.get(page)?.drawer === true;
}

export function sourceOf(sourceId: string): SourceDefinition | undefined {
  return views.find((view) => view.sources && sourceId.startsWith(view.sources.prefix))?.sources;
}

export function opensInApp(url: string): boolean {
  return views.some((view) => view.opensLink?.(url));
}

export function sourceTitle(sourceId: string, client: QueryClient): string | undefined {
  for (const view of views) {
    const title = view.sourceTitle?.(sourceId, client);
    if (title !== undefined) return title;
  }
  return undefined;
}

export function officeRefOf(sourceId: string): ResourceRef | undefined {
  for (const view of views) {
    const ref = view.officeRef?.(sourceId);
    if (ref !== undefined) return ref;
  }
  return undefined;
}

export function sourceOfLink(url: string, client: QueryClient): string | undefined {
  for (const view of views) {
    const sourceId = view.sourceOfLink?.(url, client);
    if (sourceId !== undefined) return sourceId;
  }
  return undefined;
}
