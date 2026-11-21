const markdownImageRefRe = /!\[([^\]\n]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;

interface MarkdownImageRef {
  path: string;
  alt: string;
  index: number;
  length: number;
}

export function matchMarkdownImageRefs(text: string): MarkdownImageRef[] {
  return [...text.matchAll(markdownImageRefRe)].map((match) => ({
    path: match[2]!,
    alt: match[1] ?? '',
    index: match.index ?? 0,
    length: match[0].length,
  }));
}

export function isRelativeAssetPath(path: string): boolean {
  if (!path || path.startsWith('#')) return false;
  if (/^[a-z][a-z0-9+.-]*:/i.test(path)) return false;
  if (path.startsWith('/') || path.startsWith('\\')) return false;
  if (/^[a-z]:[\\/]/i.test(path)) return false;
  return true;
}

export function decodeAssetPath(path: string): string {
  try {
    return decodeURI(path).replace(/%28/gi, '(').replace(/%29/gi, ')');
  } catch {
    return path;
  }
}

export function noteAssetUrl(entryId: string, ref: string): string {
  return `delion-resource://note-asset/${encodeURIComponent(ref)}?id=${encodeURIComponent(entryId)}`;
}
