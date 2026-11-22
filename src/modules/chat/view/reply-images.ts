import { chatImageToken } from '../../../core/protocol/chat-input';
import type { ImagePreview, ImagePreviewSource, ReplyImageSource } from '../contract';
import { chatClient } from './client';

export type ReplyImageItem = ReplyImageSource & { alt: string };
export type ReplyImagePreview = ReplyImageItem & { src: string; preview?: ImagePreview | null };

export const SINGLE_IMAGE_HEIGHT = 160;
export const GALLERY_MAX_HEIGHT = (SINGLE_IMAGE_HEIGHT * 2) / 3;
export const GALLERY_MIN_HEIGHT = SINGLE_IMAGE_HEIGHT / 2;
export const GALLERY_GAP = 8;
export const GALLERY_MIN_TILE = 64;
export const FALLBACK_RATIO = 4 / 3;

export function galleryLayout(
  ratios: number[],
  width: number,
): { height: number; shown: number; overflow: boolean } {
  const count = ratios.length;
  const gaps = GALLERY_GAP * (count - 1);
  const total = ratios.reduce((sum, ratio) => sum + ratio, 0);
  if (!width || total * GALLERY_MAX_HEIGHT + gaps <= width)
    return { height: GALLERY_MAX_HEIGHT, shown: count, overflow: false };
  const fitted = (width - gaps) / total;
  if (fitted >= GALLERY_MIN_HEIGHT) return { height: fitted, shown: count, overflow: false };
  let used = 0;
  let fully = 0;
  for (const ratio of ratios) {
    const next = used + (fully ? GALLERY_GAP : 0) + ratio * GALLERY_MIN_HEIGHT;
    if (next + GALLERY_GAP + GALLERY_MIN_TILE > width) break;
    used = next;
    fully += 1;
  }
  return { height: GALLERY_MIN_HEIGHT, shown: fully + 1, overflow: true };
}

export function replyImageUrl(sessionId: string, path: string): string {
  return `delion-resource://reply-image/${encodeURIComponent(sessionId)}?path=${encodeURIComponent(path)}`;
}

export function chatMediaUrl(id: string): string {
  return `delion-resource://chat-media/${encodeURIComponent(id)}`;
}

export function replyImageSrc(sessionId: string, image: ReplyImageItem): string {
  return 'url' in image ? image.url : replyImageUrl(sessionId, image.path);
}

export async function fetchImagePreview(source: ImagePreviewSource): Promise<ImagePreview | null> {
  const preview = await chatClient.imagePreview(source);
  if (!preview || 'url' in preview) return preview;

  const image = new Image();
  const url = URL.createObjectURL(new Blob([preview.bytes], { type: preview.mime }));
  try {
    image.src = url;
    await image.decode();
    const { naturalWidth: width, naturalHeight: height } = image;
    if (!width || !height) return null;
    const scale = Math.min(1, 480 / Math.max(width, height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    const context = canvas.getContext('2d');
    if (!context) return null;
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return { url: canvas.toDataURL(), width, height };
  } finally {
    URL.revokeObjectURL(url);
  }
}

function absolutePath(path: string, cwd: string | null): string {
  if (!cwd || /^(?:[a-z]:[\\/]|[\\/]|file:)/i.test(path)) return path;
  const separator = /^[a-z]:\\/i.test(cwd) ? '\\' : '/';
  return `${cwd.replace(/[\\/]+$/, '')}${separator}${path}`;
}

export async function imageQuestion(
  sessionId: string,
  cwd: string | null,
  image: ReplyImageItem,
  question: string,
): Promise<{ text: string; context: string[] }> {
  if ('path' in image)
    return { text: `@${image.path} ${question}`, context: [absolutePath(image.path, cwd)] };
  const { url } = image;
  const view = await chatClient.stageReplyImage({ sessionId, image: { url } });
  return { text: `${question}\n${chatImageToken(view.id, view.name)}`, context: [] };
}
