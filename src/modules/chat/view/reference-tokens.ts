import type { ChatSessionSummary } from '../../../core/protocol/agent';
import type { WorkspaceEntry } from '../../workspace/contract';
import type { ChatReference } from './drafts';

export interface ReferenceToken {
  start: number;
  end: number;
  ref: ChatReference;
}

const TRAILING_PUNCT = new Set([
  '.',
  ',',
  ';',
  ':',
  '!',
  '?',
  ')',
  ']',
  '}',
  '"',
  "'",
  '`',
  '、',
  '，',
  '。',
  '；',
  '：',
  '！',
  '？',
  '）',
  '】',
  '》',
  '」',
  '’',
  '”',
]);

const MAX_SPACE_EXTENSIONS = 8;

function knownTitle(value: string, titles: Map<string, ChatReference>): string {
  let end = value.length;
  while (end > 0 && !titles.has(value.slice(0, end)) && TRAILING_PUNCT.has(value[end - 1]!))
    end -= 1;
  return value.slice(0, end);
}

export function matchReferenceTokens(text: string, options: ChatReference[]): ReferenceToken[] {
  const bySigil = { '@': new Map<string, ChatReference>(), '#': new Map<string, ChatReference>() };
  for (const ref of options) {
    const titles = bySigil[ref.session ? '#' : '@'];
    if (!titles.has(ref.title)) titles.set(ref.title, ref);
  }
  if (bySigil['@'].size + bySigil['#'].size === 0) return [];
  const tokens: ReferenceToken[] = [];
  const run = /(?:^|\s)([@#])([^\s]+)/g;
  for (const match of text.matchAll(run)) {
    const byTitle = bySigil[match[1] as '@' | '#'];
    const at = (match.index ?? 0) + match[0].length - match[2]!.length - 1;
    let segEnd = at + 1 + match[2]!.length;
    for (let extend = 0; ; extend += 1) {
      const candidate = knownTitle(text.slice(at + 1, segEnd), byTitle);
      const ref = byTitle.get(candidate);
      if (ref) {
        tokens.push({ start: at, end: at + 1 + candidate.length, ref });
        break;
      }
      if (extend === MAX_SPACE_EXTENSIONS) break;
      const space = text.indexOf(' ', segEnd);
      if (space < 0) break;
      const nextBlank = /\s/.exec(text.slice(space + 1));
      segEnd = nextBlank ? space + 1 + nextBlank.index : text.length;
    }
  }
  return tokens;
}

export function referenceContext(text: string, options: ChatReference[]): ChatReference[] {
  const seen = new Set<string>();
  const refs: ChatReference[] = [];
  for (const token of matchReferenceTokens(text, options)) {
    if (seen.has(token.ref.key)) continue;
    seen.add(token.ref.key);
    refs.push(token.ref);
  }
  return refs;
}

export function sourceReferences(sources: { key: string }[]): ChatReference[] {
  return sources.flatMap(({ key }) => {
    const segments = key.split(/[\\/]/).filter(Boolean);
    return segments.map((_, index) => ({ key, title: segments.slice(index).join('/') }));
  });
}

function virtualLink(path: string): string | null {
  const normalized = path.replaceAll('\\', '/').replace(/^\.\//, '');
  const name = ['privacy', 'delivery'].find(
    (root) =>
      normalized === root ||
      normalized === `/${root}` ||
      normalized.startsWith(`${root}/`) ||
      normalized.startsWith(`/${root}/`),
  );
  if (!name) return null;
  return normalized.startsWith('/') ? normalized : `/${normalized}`;
}

export function fileLinkKey(
  path: string,
  cwd: string | null,
  remoteProjectId: string | null,
  restricted = false,
) {
  const virtual = restricted ? virtualLink(path) : null;
  if (virtual) return remoteProjectId ? `${remoteProjectId}:${virtual}` : virtual;
  const absolute =
    !cwd || /^(?:[a-z]:[\\/]|[\\/])/i.test(path)
      ? path
      : `${cwd.replace(/[\\/]+$/, '')}/${path.replace(/^\.[\\/]/, '')}`;
  if (remoteProjectId) return `${remoteProjectId}:${absolute}`;
  return /^[a-z]:[\\/]/i.test(absolute) ? absolute.replaceAll('/', '\\') : absolute;
}

const pad = (value: number) => String(value).padStart(2, '0');

export function sessionReferences(
  sessions: ChatSessionSummary[],
  currentId: string | null,
): ChatReference[] {
  const others = sessions
    .filter((session) => session.id !== currentId)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const counts = new Map<string, number>();
  for (const { title } of others) counts.set(title, (counts.get(title) ?? 0) + 1);
  return others.map(({ id, title, createdAt }) => {
    const at = new Date(createdAt);
    const suffix = ` · ${pad(at.getMonth() + 1)}-${pad(at.getDate())} ${pad(at.getHours())}:${pad(at.getMinutes())}`;
    return { key: id, title: counts.get(title)! > 1 ? `${title}${suffix}` : title, session: true };
  });
}

function relativeTo(path: string, base: string): string | null {
  const windows = /^(?:[a-z]:[\\/]|\\\\)/i.test(base);
  const target = windows ? path.replaceAll('\\', '/') : path;
  const root = (windows ? base.replaceAll('\\', '/') : base).replace(/\/+$/, '') + '/';
  const matches = windows
    ? target.toLowerCase().startsWith(root.toLowerCase())
    : target.startsWith(root);
  return matches && target.length > root.length ? target.slice(root.length) : null;
}

export function referenceCandidates(
  entries: WorkspaceEntry[],
  cwd: string | null,
  projectId: string | null,
  workspaceRoot: string | null = null,
): ChatReference[] {
  if (!cwd) return [];
  const general = projectId === null;
  const foreign = general
    ? entries.filter((entry) => entry.kind === 'project' && entry.path).map((entry) => entry.path!)
    : [];
  const roots = general && workspaceRoot ? [cwd, workspaceRoot] : [cwd];
  const seen = new Set<string>();
  const refs: ChatReference[] = [];
  for (const root of roots) {
    for (const entry of entries) {
      const path = entry.path;
      if (!path || entry.kind === 'folder' || entry.kind === 'project') continue;
      const title = relativeTo(path, root);
      if (title === null || seen.has(title)) continue;
      if (foreign.some((project) => relativeTo(path, project) !== null)) continue;
      seen.add(title);
      refs.push({ key: path, title });
    }
  }
  return refs;
}

export function referenceEntryCandidates(
  entries: WorkspaceEntry[],
  cwd: string | null,
  projectId: string | null,
  remote: string | null | undefined,
  remoteEntries: ChatReference[],
  workspaceRoot: string | null = null,
): ChatReference[] {
  if (remote) return remoteEntries;
  return referenceCandidates(entries, cwd, projectId, workspaceRoot);
}
