import { createReadStream } from 'node:fs';
import { readFile, stat, writeFile } from 'node:fs/promises';
import { basename, posix, resolve } from 'node:path';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { chatMediaPath, readChatMediaBytes, stageChatMedia } from '../../../core/agent/media';
import { executionMode } from '../../../core/agent/sandbox/mode';
import { scopedReferencePath } from '../../../core/agent/sandbox/scoped-files';
import { row, sessionCwd } from '../../../core/agent/session/store';
import { hostPorts } from '../../../core/ports';
import type { ChatMediaView } from '../../../core/protocol/agent';
import { extensionOf, imageMimeOf } from '../../../core/protocol/files';
import { readRemoteRange, statRemoteFile } from '../../../core/remote/operations';
import type { RemoteTarget } from '../../../core/remote/transport';
import type { ImagePreview, ImagePreviewSource, ReplyImageSource } from '../contract';

const REPLY_IMAGE_MAX_BYTES = 20 * 1024 * 1024;
const REMOTE_CHUNK_BYTES = 1024 * 1024;

const mimeExtension: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/gif': '.gif',
  'image/webp': '.webp',
  'image/bmp': '.bmp',
  'image/svg+xml': '.svg',
};

type ImageFile =
  { kind: 'local'; path: string } | { kind: 'remote'; target: RemoteTarget; path: string };

function locateImage(sessionId: string, path: string): ImageFile {
  if (!imageMimeOf(path)) throw new Error('不支持的图片格式');
  const meta = row(sessionId);
  if (executionMode(meta) !== 'full')
    return { kind: 'local', path: scopedReferencePath(meta, path) };
  const cwd = sessionCwd(meta.project_id, meta.cwd);
  const remote = meta.project_id ? hostPorts().projects.remoteOf(meta.project_id) : null;
  if (remote) return { kind: 'remote', target: remote.target, path: posix.resolve(cwd, path) };
  return {
    kind: 'local',
    path: path.startsWith('file:') ? fileURLToPath(path) : resolve(cwd, path),
  };
}

async function readRemoteImage(target: RemoteTarget, path: string): Promise<Buffer> {
  const size = (await statRemoteFile(target, path)).size ?? 0;
  if (size > REPLY_IMAGE_MAX_BYTES) throw new Error('图片超过 20MB');
  const chunks: Buffer[] = [];
  for (let offset = 0; offset < size;) {
    const chunk = await readRemoteRange(
      target,
      path,
      offset,
      Math.min(REMOTE_CHUNK_BYTES, size - offset),
    );
    if (!chunk.length) break;
    chunks.push(chunk);
    offset += chunk.length;
  }
  return Buffer.concat(chunks);
}

async function assertLocalImage(path: string): Promise<void> {
  const file = await stat(path);
  if (!file.isFile() || file.size > REPLY_IMAGE_MAX_BYTES) throw new Error('图片不可读取');
}

async function downloadImage(url: string): Promise<{ name: string; bytes: Buffer }> {
  const response = await hostPorts().network.fetch(url, { credentials: 'omit' });
  if (!response.ok) throw new Error(`图片下载失败（HTTP ${response.status}）`);
  const mime = response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() ?? '';
  const extension = mimeExtension[mime];
  if (!extension) throw new Error('链接内容不是图片');
  if (!response.body) throw new Error('链接内容不是图片');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > REPLY_IMAGE_MAX_BYTES) {
        await reader.cancel();
        throw new Error('图片超过 20MB');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = Buffer.concat(chunks, size);
  const name = decodeURIComponent(posix.basename(new URL(url).pathname)) || 'image';
  return { name: imageMimeOf(name) ? name : `${name}${extension}`, bytes };
}

async function readReplyImage(
  sessionId: string,
  source: ReplyImageSource,
): Promise<{ name: string; bytes: Buffer }> {
  if ('url' in source) {
    if (executionMode(row(sessionId)) !== 'full') throw new Error('当前权限无法获取外部图片');
    return downloadImage(source.url);
  }
  const file = locateImage(sessionId, source.path);
  if (file.kind === 'remote')
    return {
      name: posix.basename(file.path),
      bytes: await readRemoteImage(file.target, file.path),
    };
  await assertLocalImage(file.path);
  return { name: basename(file.path), bytes: await readFile(file.path) };
}

async function saveImage(image: { name: string; bytes: Buffer }): Promise<boolean> {
  const extension = extensionOf(image.name).slice(1) || 'png';
  const target = await hostPorts().desktop.pickSavePath(hostPorts().workspaceClient(), {
    title: '下载图片',
    defaultPath: image.name,
    extension,
  });
  if (!target) return false;
  await writeFile(target, image.bytes);
  return true;
}

export async function saveReplyImage(
  sessionId: string,
  source: ReplyImageSource,
): Promise<boolean> {
  return saveImage(await readReplyImage(sessionId, source));
}

export function saveChatImage(id: string, name: string): Promise<boolean> {
  return saveImage({ name, bytes: readChatMediaBytes(id) });
}

export async function readImagePreview(
  source: ImagePreviewSource,
): Promise<ImagePreview | { bytes: ArrayBuffer; mime: string } | null> {
  let image: { name: string; bytes: Buffer };
  if ('id' in source) {
    const path = chatMediaPath(source.id);
    if (!path || !imageMimeOf(path)) return null;
    image = { name: path, bytes: await readFile(path) };
  } else {
    image = await readReplyImage(source.sessionId, source.image);
  }
  const mime = imageMimeOf(image.name);
  if (!mime) return null;
  const preview = mime === 'image/jpeg' ? null : hostPorts().imageCodec.preview(image.bytes);
  return preview ?? { bytes: Uint8Array.from(image.bytes).buffer, mime };
}

export async function stageReplyImage(
  sessionId: string,
  source: ReplyImageSource,
): Promise<ChatMediaView> {
  const image = await readReplyImage(sessionId, source);
  const view = stageChatMedia(image.name, image.bytes);
  if (view.kind !== 'image') throw new Error('只能询问 PNG、JPEG、GIF 或 WebP 图片');
  return view;
}

export async function chatMediaResponse(_request: Request, url: URL): Promise<Response> {
  const path = chatMediaPath(decodeURIComponent(url.pathname.slice(1)));
  const mime = path && imageMimeOf(path);
  if (!path || !mime) throw new Error('图片不存在或已过期');
  return new Response(Readable.toWeb(createReadStream(path)) as never, {
    headers: {
      'content-type': mime,
      'cache-control': 'no-cache',
      'x-content-type-options': 'nosniff',
    },
  });
}

export async function replyImageResponse(_request: Request, url: URL): Promise<Response> {
  const sessionId = decodeURIComponent(url.pathname.slice(1));
  const path = url.searchParams.get('path');
  if (!sessionId || !path) throw new Error('无效的图片地址');
  const file = locateImage(sessionId, path);
  const headers = {
    'content-type': imageMimeOf(path)!,
    'cache-control': 'no-cache',
    'x-content-type-options': 'nosniff',
  };
  if (file.kind === 'remote') {
    const bytes = await readRemoteImage(file.target, file.path);
    return new Response(new Uint8Array(bytes), { headers });
  }
  await assertLocalImage(file.path);
  return new Response(Readable.toWeb(createReadStream(file.path)) as never, { headers });
}
