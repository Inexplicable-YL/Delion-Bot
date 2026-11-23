import { readFile, realpath, stat } from 'node:fs/promises';
import { dirname, isAbsolute, posix, relative, resolve, sep } from 'node:path';
import {
  extensionOf,
  imageMimeOf,
  isHtmlFile,
  TEXT_EDIT_MAX_BYTES,
  TEXT_PREVIEW_MAX_BYTES,
} from '../../../core/protocol/files';
import { readRemoteRange, remoteBackend, statRemoteFile } from '../../../core/remote/operations';
import { shellQuote } from '../../../core/remote/transport';
import { isRelativeAssetPath, parseRemoteNodeId } from '../contract';
import { remotePathIn, remoteTargetOf } from './actions';
import { workspaceFilePath } from './api';

const staticTypes: Record<string, string> = {
  '.css': 'text/css',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
};

export async function readHtmlAsset(documentId: string, ref: string) {
  const mime = imageMimeOf(ref) ?? staticTypes[extensionOf(ref)];
  if (
    !mime ||
    !isRelativeAssetPath(ref) ||
    ref.includes(':') ||
    ref.includes('\\') ||
    ref.includes('\0')
  )
    return null;
  const limit = mime === 'text/css' ? TEXT_EDIT_MAX_BYTES : TEXT_PREVIEW_MAX_BYTES;
  const inside = (suffix: string, separator: string) =>
    suffix !== '' && suffix !== '..' && !suffix.startsWith(`..${separator}`);
  try {
    let bytes: Buffer;
    const remote = parseRemoteNodeId(documentId);
    if (remote) {
      if (!isHtmlFile(remote.path)) return null;
      const { target, root } = remoteTargetOf(remote.projectId);
      const base = posix.dirname(remotePathIn(root, posix.normalize(remote.path)));
      const path = posix.resolve(base, ref);
      if (!inside(posix.relative(base, path), '/')) return null;
      const output: Buffer[] = [];
      const result = await remoteBackend(target).bash.exec(
        `realpath -ez -- ${shellQuote(base)} ${shellQuote(path)}`,
        base,
        { timeout: 15, onData: (chunk) => output.push(chunk) },
      );
      const [realBase, realFile] = Buffer.concat(output).toString('utf8').split('\0');
      if (
        result.exitCode !== 0 ||
        !realBase ||
        !realFile ||
        !inside(posix.relative(realBase, realFile), '/')
      )
        return null;
      const { size } = await statRemoteFile(target, realFile);
      if (size === null || size > limit) return null;
      bytes = await readRemoteRange(target, realFile, 0, size);
    } else {
      const file = await workspaceFilePath(documentId);
      if (!isHtmlFile(file)) return null;
      const base = await realpath(dirname(file));
      const path = resolve(base, ref);
      const requested = relative(base, path);
      if (isAbsolute(requested) || !inside(requested, sep)) return null;
      const asset = await realpath(path);
      const suffix = relative(base, asset);
      if (isAbsolute(suffix) || !inside(suffix, sep)) return null;
      const info = await stat(asset);
      if (!info.isFile() || info.size > limit) return null;
      bytes = await readFile(asset);
    }
    return {
      mime,
      content: bytes.toString(mime === 'text/css' ? 'utf8' : 'base64'),
    };
  } catch {
    return null;
  }
}
