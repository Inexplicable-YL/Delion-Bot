import { fileTypeFromFile } from 'file-type';

export type OfficeZipKind = 'docx' | 'pptx' | 'xlsx';
export const officeZipMime: Record<OfficeZipKind, string> = {
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
};

export async function classifyOfficeFile(path: string): Promise<OfficeZipKind | null> {
  const kind = await fileTypeFromFile(path).catch(() => undefined);
  return kind?.ext === 'docx' || kind?.ext === 'pptx' || kind?.ext === 'xlsx' ? kind.ext : null;
}
