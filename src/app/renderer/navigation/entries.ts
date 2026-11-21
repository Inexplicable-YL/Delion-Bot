import type { ComponentType } from 'react';
import { LibraryIcon } from '../../../ui/LibraryIcon';
import type { NavTargets } from '../../module';
import { navPages } from '../../views';
import { usePreferences } from '../shell/preferences';

export type NavEntryId = 'sources' | keyof NavTargets;

export const navEntries: Array<{
  id: NavEntryId;
  label: string;
  icon: ComponentType<{ className?: string; strokeWidth?: number }>;
}> = [{ id: 'sources', label: '资料', icon: LibraryIcon }, ...navPages];

export function useVisibleNavEntries() {
  const hidden = usePreferences((state) => state.hiddenNavEntries);
  return navEntries.filter((entry) => !hidden.includes(entry.id));
}
