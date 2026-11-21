import changelog from '../../../../CHANGELOG.md?raw';

export interface ReleaseNote {
  version: string;
  date: string;
  items: string[];
}

const lastSeenKey = 'delion.release-notes.last-seen';

export function parseReleaseNotes(markdown: string): ReleaseNote[] {
  const notes: ReleaseNote[] = [];
  for (const section of markdown.split(/^## /m).slice(1)) {
    const heading = /^(\d+\.\d+\.\d+)\s*-\s*(\S+)/.exec(section);
    if (!heading) continue;
    const items = section
      .split('\n')
      .filter((line) => line.startsWith('- '))
      .map((line) => line.slice(2).trim());
    if (items.length) notes.push({ version: heading[1]!, date: heading[2]!, items });
  }
  return notes;
}

function compareVersions(a: string, b: string): number {
  const left = a.split('.').map(Number);
  const right = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) if (left[i] !== right[i]) return (left[i] ?? 0) - (right[i] ?? 0);
  return 0;
}

export function notesBetween(
  notes: ReleaseNote[],
  lastSeen: string,
  current: string,
): ReleaseNote[] {
  return notes
    .filter(
      (note) =>
        compareVersions(note.version, lastSeen) > 0 && compareVersions(note.version, current) <= 0,
    )
    .sort((a, b) => compareVersions(b.version, a.version));
}

export function takePendingReleaseNotes(current: string): ReleaseNote[] {
  const lastSeen = localStorage.getItem(lastSeenKey);
  localStorage.setItem(lastSeenKey, current);
  if (lastSeen === null) return [];
  const notes = parseReleaseNotes(changelog);
  return notesBetween(notes, lastSeen, current);
}
