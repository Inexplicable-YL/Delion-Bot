import { closeSync, openSync, readFileSync, readSync, statSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import {
  SNIFF_BYTES,
  TEXT_EDIT_MAX_BYTES,
  TEXT_PREVIEW_MAX_BYTES,
  fileFormatOf,
  formatByName,
  isTextContent,
  type FileFormat,
} from '../../../core/protocol/files';

export const textRevision = (text: string) => createHash('sha256').update(text).digest('hex');

function readHead(path: string, size: number): Buffer {
  const buffer = Buffer.alloc(size);
  const fd = openSync(path, 'r');
  try {
    const read = readSync(fd, buffer, 0, size, 0);
    return buffer.subarray(0, read);
  } finally {
    closeSync(fd);
  }
}

export function localFileFormat(path: string): FileFormat {
  const named = formatByName(path);
  if (named) return named;
  const size = statSync(path).size;
  return fileFormatOf(path, readHead(path, Math.min(size, SNIFF_BYTES)), size > SNIFF_BYTES);
}

export type LocalText =
  | {
      kind: 'text';
      format: 'markdown' | 'text';
      text: string;
      readOnly: boolean;
      truncated: boolean;
    }
  | { kind: 'binary' };

export function readLocalText(path: string, format: 'markdown' | 'text'): LocalText {
  const size = statSync(path).size;
  if (size > TEXT_PREVIEW_MAX_BYTES) return { kind: 'binary' };
  const truncated = size > TEXT_EDIT_MAX_BYTES;
  const bytes = truncated ? readHead(path, TEXT_EDIT_MAX_BYTES) : readFileSync(path);
  if (!isTextContent(bytes, truncated)) return { kind: 'binary' };
  let text = bytes.toString('utf8');
  if (truncated) text = text.replace(/\uFFFD+$/, '');
  return { kind: 'text', format, text, readOnly: truncated, truncated };
}

export function writeLocalText(path: string, text: string, revision: string): string {
  if (statSync(path).size > TEXT_EDIT_MAX_BYTES) throw new Error('文件超过 1 MB，只能只读查看');
  const disk = readFileSync(path, 'utf8');
  if (textRevision(disk) !== revision)
    throw new Error('文件已在外部修改。你的草稿仍在，请另存或重新载入后编辑。');
  writeFileSync(path, text);
  return textRevision(text);
}
