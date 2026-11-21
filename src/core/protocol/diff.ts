export interface DiffStat {
  added: number;
  deleted: number;
}

export function diffStatOf(patch: string | null): DiffStat | null {
  if (!patch) return null;
  let added = 0;
  let deleted = 0;
  let inHunk = false;
  for (const line of patch.split('\n')) {
    if (line.startsWith('@@')) {
      inHunk = true;
      continue;
    }
    if (!inHunk) continue;
    if (line.startsWith('+')) added += 1;
    else if (line.startsWith('-')) deleted += 1;
  }
  return { added, deleted };
}
