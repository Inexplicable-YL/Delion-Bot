import { SNIFF_BYTES, formatByName, imageMimeOf, isTextContent } from './files';

export const INLINE_IMAGE_MAX = 6;
export const CHAT_ATTACHMENT_MAX = 5;
export const CHAT_IMAGE_MAX_BYTES = 5 * 1024 * 1024;
export const CHAT_TEXT_ATTACHMENT_MAX_BYTES = 1024 * 1024;
export const CHAT_DOCUMENT_MAX_BYTES = 128 * 1024 * 1024;

const chatImageMimes = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);

type ChatBlock = { type: 'text'; text: string } | { type: 'image'; id: string; name: string };

const chatImageTokenRe =
  /!\[([^\]\n]*)\]\(delion-img:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\)/g;

export function parseChatBlocks(text: string): ChatBlock[] {
  const blocks: ChatBlock[] = [];
  let cursor = 0;
  for (const match of matchChatImageTokens(text)) {
    const index = match.index ?? 0;
    if (index > cursor) blocks.push({ type: 'text', text: text.slice(cursor, index) });
    blocks.push({ type: 'image', id: match[2]!, name: match[1] ?? '' });
    cursor = index + match[0].length;
  }
  if (cursor < text.length) blocks.push({ type: 'text', text: text.slice(cursor) });
  return blocks;
}

export function matchChatImageTokens(text: string): RegExpMatchArray[] {
  return [...text.matchAll(chatImageTokenRe)];
}

export function stripChatImageTokens(text: string): string {
  return text.replace(chatImageTokenRe, '').trim();
}

export function hasChatImages(text: string): boolean {
  return text.search(chatImageTokenRe) !== -1;
}

export function chatImageToken(id: string, name: string): string {
  const alt = name.replace(/[[\]\n]/g, ' ').trim() || '图片';
  return `![${alt}](delion-img:${id})`;
}

export function chatFileKind(
  name: string,
  head: Uint8Array,
  truncated = false,
): 'image' | 'text' | 'document' {
  const format = formatByName(name);
  if (format === 'image' && chatImageMimes.has(imageMimeOf(name) ?? '')) return 'image';
  if (format === 'markdown') return 'text';
  if (format && format !== 'image') return 'document';
  return isTextContent(head, truncated) ? 'text' : 'document';
}

export async function chatFileKindOfFile(file: File): Promise<'image' | 'text' | 'document'> {
  const head = new Uint8Array(await file.slice(0, SNIFF_BYTES).arrayBuffer());
  return chatFileKind(file.name, head, file.size > SNIFF_BYTES);
}
