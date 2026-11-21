const accentNames = ['blue', 'teal', 'sage', 'sand', 'peach', 'rose', 'lilac', 'slate'] as const;

export function remoteAccent(
  remoteId: string | null | undefined,
  part: 'text' | 'bg' = 'text',
): string {
  if (!remoteId) return part === 'bg' ? 'var(--field)' : 'var(--ink-3)';
  let hash = 2166136261;
  for (const char of remoteId) {
    hash ^= char.codePointAt(0)!;
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return `var(--cal-${accentNames[(hash >>> 8) % accentNames.length]}-${part})`;
}
