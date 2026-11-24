import { realpathSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';

const VIRTUAL = ['privacy', 'delivery'] as const;
export type VirtualRoot = (typeof VIRTUAL)[number];

export function sandboxPath(input: string): string {
  const normalized = input.trim().replaceAll('\\', '/');
  if (!normalized || normalized === '.') return '/privacy';
  if (/^[A-Za-z]:\//.test(normalized) || normalized.startsWith('//')) return normalized;
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

function covers(parent: string, child: string): boolean {
  const rel = relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

function concealedPath(path: string, concealed: readonly string[]): boolean {
  return concealed.some((secret) => {
    if (!(secret.startsWith('/') || /^[A-Za-z]:[\\/]/.test(secret))) return false;
    if (covers(secret, path)) return true;
    try {
      return covers(realpathSync(secret), path);
    } catch {
      return false;
    }
  });
}

export function restrictedLocalPath(
  input: string,
  roots: { privacy: string; delivery: string },
  concealed: readonly string[],
): string {
  const virtual = resolveVirtualHost(input, roots);
  if (virtual.kind === 'denied') throw new Error('路径超出会话目录');
  if (virtual.kind === 'host') return virtual.path;
  const lexical = resolve(input);
  let real = lexical;
  try {
    real = realpathSync(lexical);
  } catch {
    real = lexical;
  }
  if (concealedPath(lexical, concealed) || concealedPath(real, concealed))
    throw new Error('路径超出会话目录');
  return lexical;
}
