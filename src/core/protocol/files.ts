export type FileFormat =
  'markdown' | 'text' | 'pdf' | 'image' | 'docx' | 'xlsx' | 'pptx' | 'binary';

export const TEXT_EDIT_MAX_BYTES = 1024 * 1024;
export const TEXT_PREVIEW_MAX_BYTES = 50 * 1024 * 1024;
export const SNIFF_BYTES = 8000;

const imageMime: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.svg': 'image/svg+xml',
};

const byExtension: Record<string, FileFormat> = {
  '.md': 'markdown',
  '.markdown': 'markdown',
  '.pdf': 'pdf',
  '.docx': 'docx',
  '.xlsx': 'xlsx',
  '.pptx': 'pptx',
  ...Object.fromEntries(Object.keys(imageMime).map((ext) => [ext, 'image' as const])),
};

export function extensionOf(name: string): string {
  const base = name.slice(Math.max(name.lastIndexOf('/'), name.lastIndexOf('\\')) + 1);
  const dot = base.lastIndexOf('.');
  return dot <= 0 ? '' : base.slice(dot).toLowerCase();
}

export function imageMimeOf(name: string): string | undefined {
  return imageMime[extensionOf(name)];
}

export function isHtmlFile(name: string): boolean {
  const extension = extensionOf(name);
  return extension === '.html' || extension === '.htm';
}

export function formatByName(name: string): FileFormat | null {
  return byExtension[extensionOf(name)] ?? null;
}

const utf8 = new TextDecoder('utf-8', { fatal: true });

export function isTextContent(head: Uint8Array, truncated = false): boolean {
  const window = head.subarray(0, SNIFF_BYTES);
  if (window.includes(0)) return false;
  let end = head.length;
  if (truncated) {
    let back = 0;
    while (back < 3 && end - back > 0 && (head[end - back - 1]! & 0xc0) === 0x80) back += 1;
    const lead = head[end - back - 1];
    if (lead !== undefined && lead >= 0xc0) end -= back + 1;
  }
  try {
    utf8.decode(head.subarray(0, end));
    return true;
  } catch {
    return false;
  }
}

export function opensInEditor(name: string): boolean {
  const format = formatByName(name);
  return format === 'markdown' || (format === null && !isHtmlFile(name));
}

export function fileFormatOf(name: string, head: Uint8Array, truncated = false): FileFormat {
  return formatByName(name) ?? (isTextContent(head, truncated) ? 'text' : 'binary');
}
