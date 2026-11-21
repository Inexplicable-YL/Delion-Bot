import { SEARCH_LIMIT, type SearchGroup, type SearchHit, type SearchIcon } from '../contract';

export interface SearchProvider {
  id: string;
  label: string;
  icon: SearchIcon;
  search(query: string, limit: number): SearchHit[];
}

const providers: SearchProvider[] = [];

export function registerSearchProvider(provider: SearchProvider): void {
  providers.push(provider);
}

export function querySearch(query: string): SearchGroup[] {
  return providers.flatMap(({ id, label, icon, search }) => {
    const hits = search(query, SEARCH_LIMIT);
    return hits.length ? [{ id, label, icon, truncated: hits.length >= SEARCH_LIMIT, hits }] : [];
  });
}

export function likePattern(query: string): string {
  return `%${query.replaceAll('!', '!!').replaceAll('%', '!%').replaceAll('_', '!_')}%`;
}
