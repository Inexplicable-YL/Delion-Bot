import { isAbsolute, relative, resolve, sep } from 'node:path';

const VIRTUAL = ['privacy', 'delivery'] as const;
export type VirtualRoot = (typeof VIRTUAL)[number];

export function sandboxPath(input: string): string {
  const normalized = input.trim().replaceAll('\\', '/');
  if (!normalized || normalized === '.') return '/privacy';
  const home = normalized.startsWith('~/')
    ? `/privacy/.home/${normalized.slice(2)}`
    : normalized === '~'
      ? '/privacy/.home'
      : normalized;
  for (const name of VIRTUAL) {
    if (home === name || home === `/${name}`) return `/${name}`;
    if (home.startsWith(`${name}/`)) return `/${name}/${home.slice(name.length + 1)}`;
    if (home.startsWith(`/${name}/`)) return home;
  }
  if (home.startsWith('/')) return home;
  return `/privacy/${home.replace(/^\.\//, '')}`;
}

export function scrubText(text: string, secrets: readonly string[]): string {
  let next = text;
  for (const secret of [...secrets]
    .filter((item) => item.length >= 8)
    .sort((a, b) => b.length - a.length))
    next = next.split(secret).join('[hidden]');
  return next;
}

export type VirtualResolution =
  { kind: 'host'; path: string } | { kind: 'denied' } | { kind: 'passthrough' };

export function resolveVirtualHost(
  input: string,
  roots: { privacy: string; delivery: string },
): VirtualResolution {
  const sandbox = sandboxPath(input);
  for (const name of VIRTUAL) {
    const prefix = `/${name}`;
    if (sandbox !== prefix && !sandbox.startsWith(`${prefix}/`)) continue;
    const rest = sandbox.slice(prefix.length).replace(/^\/+/, '');
    const root = name === 'privacy' ? roots.privacy : roots.delivery;
    const target = resolve(root, ...rest.split('/').filter(Boolean));
    const rel = relative(root, target);
    if (rel === '' || (!rel.startsWith('..') && !isAbsolute(rel) && !rel.split(sep).includes('..')))
      return { kind: 'host', path: target };
    return { kind: 'denied' };
  }
  return { kind: 'passthrough' };
}
