import { z } from 'zod';
import { defineContract } from '../../core/protocol/contract';
import type { NavTarget } from '../../app/module';

export const SEARCH_LIMIT = 10;

export type SearchIcon = 'folder' | 'message' | 'file' | 'check' | 'settings';

export interface SearchHit {
  id: string;
  title: string;
  subtitle: string | null;
  target: NavTarget;
  archived?: boolean;
}

export interface SearchGroup {
  id: string;
  label: string;
  icon: SearchIcon;
  truncated: boolean;
  hits: SearchHit[];
}

export const searchContract = defineContract('search', {
  query: { input: z.string().trim().max(200), output: z.custom<SearchGroup[]>() },
});
