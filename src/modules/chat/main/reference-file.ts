import { readFile, realpath, stat } from 'node:fs/promises';
import { isAbsolute, join, posix, relative, resolve, sep } from 'node:path';
import { executionMode, sandboxRoots } from '../../../core/agent/sandbox/mode';
import { restrictedLocalPath } from '../../../core/agent/sandbox/paths';
import { locateSessionFile } from '../../../core/agent/session/files';
import { row, sessionCwd } from '../../../core/agent/session/store';
import { hostPorts } from '../../../core/ports';
import { isTextContent, TEXT_PREVIEW_MAX_BYTES } from '../../../core/protocol/files';
import { readRemoteRange, statRemoteFile } from '../../../core/remote/operations';
import { helperSession } from '../../../core/remote/helper';
import { openInVsCode } from '../../workspace';
import { hiddenWorkspaceNames } from '../../workspace/contract';

function referenceFile(sessionId: string, path: string) {
  const meta = row(sessionId);
  const cwd = sessionCwd(meta.project_id, meta.cwd);
  const remote = meta.project_id ? hostPorts().projects.remoteOf(meta.project_id) : null;
  if (remote) return { path: posix.resolve(cwd, path), target: remote.target };
  if (executionMode(meta) === 'restricted') {
    const roots = sandboxRoots(meta.parent_id ?? meta.id);
    return {
      path: restrictedLocalPath(
        path,
        { privacy: roots.privacyHost, delivery: roots.deliveryHost },
        roots.conceal,
      ),
      target: null,
    };
  }
  return { path: resolve(cwd, path), target: null };
}

export function referenceFilePath(sessionId: string, path: string): string {
  return referenceFile(sessionId, path).path;
}

export async function referenceFileInfo(sessionId: string, path: string) {
  const file = referenceFile(sessionId, path);
  const directory = file.target
    ? ((await helperSession(file.target).stat([file.path]))[0]?.directory ?? false)
    : (await stat(file.path)).isDirectory();
  const root = join(hostPorts().paths.storage(), 'workspace');
  const suffix = relative(root, file.path);
  const segments = suffix.split(sep);
  const workspaceFolder =
    !file.target &&
    directory &&
    suffix !== '' &&
    !isAbsolute(suffix) &&
    !segments.some((segment) => segment === '..' || hiddenWorkspaceNames.has(segment)) &&
    relative(join(await realpath(root), suffix), await realpath(file.path)) === '';
  return { path: file.path, directory, workspaceFolder };
}

export async function openReferenceDirectory(sessionId: string, path: string): Promise<void> {
  const file = referenceFile(sessionId, path);
  if (file.target) throw new Error('远程文件夹无法在本机文件管理器中打开');
  if (!(await stat(file.path)).isDirectory()) throw new Error('请选择文件夹');
  await hostPorts().desktop.open(file.path);
}

export async function readReferenceFile(sessionId: string, path: string): Promise<string> {
  const file = referenceFile(sessionId, path);
  const info = file.target ? await statRemoteFile(file.target, file.path) : await stat(file.path);
  if ('isFile' in info && !info.isFile()) throw new Error('请选择文件');
  if ((info.size ?? 0) > TEXT_PREVIEW_MAX_BYTES) throw new Error('文件超过 50 MB');
  const bytes = file.target
    ? await readRemoteRange(file.target, file.path, 0, TEXT_PREVIEW_MAX_BYTES)
    : await readFile(file.path);
  if (!isTextContent(bytes)) throw new Error('仅支持复制文本文件的内容');
  return bytes.toString('utf8');
}

export function openReferenceInVsCode(sessionId: string, path: string): Promise<void> {
  const file = referenceFile(sessionId, path);
  return file.target
    ? openInVsCode(file.path, `ssh-remote+${file.target.host}`)
    : openInVsCode(locateSessionFile(sessionId, path));
}
