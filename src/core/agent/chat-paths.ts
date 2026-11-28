import { realpathSync } from 'node:fs';
import { hostPorts } from '../ports';

const virtualNames = { 'chat-sessions': '/privacy', 'chat-share': '/share' } as const;

function chatPathPattern(): RegExp {
  const storage = hostPorts().paths.storage();
  let canonical = storage;
  try {
    canonical = realpathSync(storage);
  } catch {}
  const roots = [...new Set([storage, canonical])].map((root) =>
    root
      .split(/[\\/]+/)
      .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
      .join('[\\\\/]+'),
  );
  return new RegExp(
    `(?:file:/{2,3})?(?:${roots.join('|')})[\\\\/]+(chat-sessions|chat-share)[\\\\/]+([0-9a-f-]{36})((?:[\\\\/][^\\s"'<>()\\[\\]\`|]*)?)`,
    process.platform === 'win32' ? 'gi' : 'g',
  );
}

export function virtualChatText(text: string): string {
  return text.replace(
    chatPathPattern(),
    (_match, directory: keyof typeof virtualNames, _session: string, rest: string) =>
      `${virtualNames[directory.toLowerCase() as keyof typeof virtualNames]}${rest.replaceAll('\\', '/').replace(/\/+$/, '')}`,
  );
}

export function foreignChatPath(text: string, ownerId: string): boolean {
  return [...text.matchAll(chatPathPattern())].some(
    ([, , session]) => session!.toLowerCase() !== ownerId.toLowerCase(),
  );
}
