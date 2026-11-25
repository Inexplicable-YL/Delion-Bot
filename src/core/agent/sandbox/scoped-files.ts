import { execFile } from 'node:child_process';
import { basename, dirname, isAbsolute, join, parse, posix, relative, sep } from 'node:path';
import { lstatSync, realpathSync } from 'node:fs';
import { isIP } from 'node:net';
import type { ToolDefinition } from '@earendil-works/pi-coding-agent';
import { hostPorts } from '../../ports';
import { imageMimeOf } from '../../protocol/files';
import {
  helperSession,
  type ScopedFileOperation,
  type ScopedFileResponse,
} from '../../remote/helper';
import { executionMode, ownerRow, scopedDirectories, type ScopedDirectory } from './mode';
import type { SessionRow } from '../session/store';
import { approveNonPublicRead, deniedMessage } from './approve-tool';
import { fetchPublicWebPage } from '../../capabilities/public-web-fetch';

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_TEXT_BYTES = 200_000;

type FileRequest = {
  path?: string;
  content?: string;
  oldText?: string;
  newText?: string;
  pattern?: string;
};
type Action = Exclude<ScopedFileOperation['action'], 'stat' | 'create'>;

const virtualRoot = /^\/(privacy|share|project)(?:\/|$)/;
const windowsDevice = /^(con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/i;
const sensitiveName =
  /^(?:\.git|git~\d+|\.ssh|\.gnupg|\.aws|\.azure|\.kube|\.docker|\.config|\.netrc|\.npmrc|\.pypirc|\.git-credentials|\.password-store|\.vault-token|\.env(?:\..*)?|\.delion-bot|appdata|\$recycle\.bin|system volume information|ntuser\.dat(?:[.{].*)?|delion-command[-.].*|.*\.(?:key|pem|pfx|p12|kdbx))$/i;

function absoluteLocalPath(input: string) {
  return process.platform === 'win32'
    ? /^[a-z]:[\\/]/i.test(input)
    : /^\/(?!\/)/.test(input) && !virtualRoot.test(input);
}

function externalPathPolicy(writable = false) {
  const windows = process.platform === 'win32';
  const { paths } = hostPorts();
  const system = windows ? parse(process.env.SystemRoot ?? 'C:\\Windows').root : '/';
  const application = writable ? paths.applicationCode?.() : undefined;
  const protectedPaths = [
    paths.userData(),
    paths.storage(),
    paths.bundled('scopedfs'),
    ...(application ? [application] : []),
    join(paths.temp(), 'delion-document-reading'),
    join(paths.home(), 'Library'),
    ...(windows
      ? ['Windows', 'ProgramData'].map((name) => join(system, name))
      : [
          '/dev',
          '/proc',
          '/sys',
          '/run',
          '/etc',
          '/private/etc',
          '/root',
          '/System',
          '/Library',
          '/private/var/db',
          '/var/db',
        ]),
  ].flatMap((path) => {
    try {
      return [path, realpathSync.native(path)];
    } catch {
      return [path];
    }
  });
  return (path: string) =>
    path
      .slice(parse(path).root.length)
      .split(windows ? /[\\/]/ : '/')
      .some(
        (name) =>
          sensitiveName.test(name) ||
          (windows && windowsDevice.test(name)) ||
          name === '..' ||
          /[\\:<>|?*"\p{Cc}\p{Cf}]/u.test(name) ||
          (name !== '.' && /[. ]$/.test(name)),
      ) ||
    protectedPaths.some((root) => {
      const key =
        process.platform === 'darwin'
          ? relative(root.toLowerCase(), path.toLowerCase())
          : relative(root, path);
      return key === '' || (!isAbsolute(key) && key !== '..' && !key.startsWith(`..${sep}`));
    });
}

async function externalRead(
  input: string,
  action: 'read' | 'ls',
  limit: number,
  signal: AbortSignal,
): Promise<ScopedFileResponse> {
  const protectedPath = externalPathPolicy();
  try {
    signal.throwIfAborted();
    if (protectedPath(input)) throw new Error();
    const path = realpathSync.native(input);
    if (!absoluteLocalPath(path) || protectedPath(path)) throw new Error();
    const result = await runLocalFileAction(
      action === 'ls' ? path : dirname(path),
      { action, path: action === 'ls' ? '.' : basename(path), limit },
      signal,
    );
    if (action === 'ls' && result.entries)
      result.entries = result.entries.filter((name) => !protectedPath(join(path, name)));
    return result;
  } catch {
    return { error: '外部路径不可用或不允许读取' };
  }
}

function targetPath(input: string, directories: ScopedDirectory[]) {
  const path = input.replaceAll('\\', '/');
  const match = virtualRoot.exec(path);
  const root = match ? directories.find(({ name }) => name === `/${match[1]}`) : directories[0];
  const suffix = match ? path.slice(match[0].length) : path;
  const segments = suffix.split('/').filter((part) => part !== '.');
  if (
    !root ||
    suffix.startsWith('/') ||
    segments.some(
      (segment) =>
        segment === '..' ||
        /[:<>|?*"\p{Cc}\p{Cf}]/u.test(segment) ||
        /[. ]$/.test(segment) ||
        /^\.git$|^git~\d+$/i.test(segment) ||
        windowsDevice.test(segment),
    )
  )
    throw new Error('路径超出聊天授权目录');
  return { root, key: segments.filter(Boolean).join('/') || '.' };
}

export function scopedReferencePath(meta: SessionRow, input: string): string {
  const { root, key } = targetPath(input, scopedDirectories(meta));
  if (root.remote) return posix.join(root.host, key);
  const path = join(root.host, key);
  const actual = realpathSync(path);
  if (relative(path, actual) !== '' || !isAbsolute(actual)) throw new Error('链接超出聊天授权目录');
  return actual;
}

export function scopedPromptPath(meta: SessionRow, input: string): string | null {
  try {
    const directories = scopedDirectories(meta);
    let virtual = input;
    for (const { host, name, remote } of directories) {
      const source =
        remote && meta.project_id && input.startsWith(`${meta.project_id}:`)
          ? input.slice(meta.project_id.length + 1)
          : input;
      const path = remote ? posix : { isAbsolute, relative };
      if (!path.isAbsolute(source)) continue;
      let canonical = source;
      if (!remote) {
        try {
          canonical = realpathSync(source);
        } catch {}
      }
      const key = path.relative(host, canonical).replaceAll('\\', '/');
      if (path.isAbsolute(key) || key === '..' || key.startsWith('../')) continue;
      virtual = key ? `${name}/${key}` : name;
      break;
    }
    const { root, key } = targetPath(virtual, directories);
    return key === '.' ? root.name : `${root.name}/${key}`;
  } catch {
    return null;
  }
}

async function runFileAction(
  root: ScopedDirectory,
  request: ScopedFileOperation,
  signal: AbortSignal,
): Promise<ScopedFileResponse> {
  if (root.remote) {
    try {
      return await helperSession(root.remote).scopedFile(root.host, request, signal);
    } catch {
      return { error: '远程文件沙箱无法完成操作' };
    }
  }
  return runLocalFileAction(root.host, request, signal);
}

function runLocalFileAction(
  directory: string,
  request: ScopedFileOperation,
  signal: AbortSignal,
): Promise<ScopedFileResponse> {
  const binary = join(
    hostPorts().paths.bundled('scopedfs'),
    process.platform === 'win32' ? 'scopedfs.exe' : 'scopedfs',
  );
  return new Promise((resolve) => {
    const child = execFile(
      binary,
      [directory],
      { env: {}, windowsHide: true, signal, timeout: 10_000, maxBuffer: 8 * 1024 * 1024 },
      (error, output) => {
        if (error || signal.aborted) {
          resolve({ error: '文件沙箱无法完成操作' });
          return;
        }
        try {
          resolve(JSON.parse(output) as ScopedFileResponse);
        } catch {
          resolve({ error: '文件沙箱返回了无效的响应' });
        }
      },
    );
    child.stdin?.on('error', () => {});
    child.stdin?.end(JSON.stringify(request));
  });
}

export async function readScopedReference(
  meta: SessionRow,
  input: string,
  action: 'read' | 'stat',
  signal?: AbortSignal,
  directories = scopedDirectories(meta),
) {
  const { root, key } = targetPath(input, directories);
  const result = await runFileAction(
    root,
    { action, path: key, limit: MAX_IMAGE_BYTES },
    signal ? AbortSignal.any([signal, AbortSignal.timeout(10_000)]) : AbortSignal.timeout(10_000),
  );
  if (result.error) throw new Error(result.error);
  return result;
}

const textResult = (text: string, isError = false) => ({
  content: [{ type: 'text' as const, text }],
  details: undefined,
  ...(isError ? { isError: true } : {}),
});

const readResult = (result: ScopedFileResponse, mime: string | null | undefined) =>
  mime && mime !== 'image/svg+xml'
    ? {
        content: [{ type: 'image' as const, data: result.data ?? '', mimeType: mime }],
        details: undefined,
      }
    : textResult(Buffer.from(result.data ?? '', 'base64').toString('utf8'));

async function externalChange(
  session: string,
  action: 'write' | 'edit' | 'mkdir' | 'delete',
  params: FileRequest & { path: string },
  signal: AbortSignal,
) {
  const { path, content, oldText, newText } = params;
  const protectedPath = externalPathPolicy(true);
  let directory: string;
  let key: string;
  let operation: typeof action | 'create' = action;
  try {
    if (protectedPath(path) || /[\\/]$/.test(path)) throw new Error();
    directory = realpathSync.native(dirname(path));
    key = basename(path);
    const target = join(directory, key);
    if (!absoluteLocalPath(directory) || protectedPath(target)) throw new Error();
    const current = lstatSync(target, { throwIfNoEntry: false });
    if (action === 'mkdir') {
      if (current?.isDirectory()) return textResult(path);
      if (current) throw new Error();
    } else if (!current && action === 'write') operation = 'create';
    else if (!current?.isFile() || protectedPath(realpathSync.native(target))) throw new Error();
  } catch {
    return textResult('外部路径不可用或不允许修改', true);
  }
  const create = operation === 'create' || operation === 'mkdir';
  const data = operation === 'edit' ? newText : content;
  if (
    Buffer.byteLength(data ?? '') > MAX_IMAGE_BYTES ||
    Buffer.byteLength(oldText ?? '') > MAX_IMAGE_BYTES
  )
    return textResult('内容上限为 5 MB', true);
  const approval = await hostPorts().desktop.approveToolAction?.({
    session,
    title: create ? '在外部目录新建' : action === 'delete' ? '删除外部文件' : '修改外部文件',
    fields: [
      { label: '路径', value: join(directory, key) },
      ...(oldText === undefined ? [] : [{ label: '替换前', value: oldText }]),
      ...(data === undefined ? [] : [{ label: '内容', value: data }]),
    ],
    ...(create && {
      grant: {
        keys: [
          `auto-create-entry:${process.platform === 'win32' ? directory.toLowerCase() : directory}`,
        ],
        label: `在 ${directory} 新建文件或文件夹`,
      },
    }),
    signal,
  });
  if (!approval?.approved || signal.aborted)
    return textResult(deniedMessage('文件操作未获批准', approval), true);
  const result = await runLocalFileAction(
    directory,
    {
      action: operation,
      path: key,
      content: data,
      oldText,
      writable: true,
    },
    signal,
  );
  return result.error ? textResult(result.error, true) : textResult(path);
}

export function downloadTool(meta: SessionRow): ToolDefinition | null {
  const automatic = executionMode(meta) === 'auto-approval';
  const directories = scopedDirectories(meta).filter(
    ({ name }) => automatic || name !== '/privacy',
  );
  if (!directories.length) return null;
  return {
    name: 'download_file',
    label: 'Download file',
    description: `Download the original binary from an HTTPS URL to ${automatic ? '/privacy, /share, or /project' : '/share or /project'}. Maximum size is 5 MiB. ${automatic && !directories[0]?.remote ? '' : 'This requires approval. '}If the server redirects, call this tool again with the returned URL.`,
    parameters: {
      type: 'object',
      properties: { url: { type: 'string', maxLength: 8192 }, path: { type: 'string' } },
      required: ['url', 'path'],
    } as unknown as ToolDefinition['parameters'],
    async execute(_id, input: { url: string; path: string }, signal) {
      let target: ReturnType<typeof targetPath>;
      let url: URL;
      try {
        target = targetPath(input.path, directories);
        url = new URL(input.url);
        if (
          target.key === '.' ||
          url.protocol !== 'https:' ||
          url.username ||
          url.password ||
          isIP(url.hostname.replace(/^\[|\]$/g, '')) ||
          !url.hostname.includes('.') ||
          /\.(?:local|localhost|internal)\.?$/i.test(url.hostname)
        )
          throw new Error();
      } catch {
        return textResult('请输入公开 HTTPS 地址和共享目录或项目内的文件路径', true);
      }
      const cancellation = AbortSignal.any([
        ...(signal ? [signal] : []),
        AbortSignal.timeout(15_000),
      ]);
      try {
        const options: RequestInit = {
          credentials: 'omit',
          redirect: 'manual',
          signal: cancellation,
        };
        const response = automatic
          ? await fetchPublicWebPage(url, options, (target) =>
              approveNonPublicRead(ownerRow(meta).id, target, cancellation),
            )
          : await fetch(url, options);
        const location =
          response.status >= 300 && response.status < 400 && response.headers.get('location');
        if (location) {
          await response.body?.cancel();
          return textResult(JSON.stringify({ redirect: new URL(location, url).toString() }));
        }
        if (
          !response.ok ||
          !response.body ||
          Number(response.headers.get('content-length')) > MAX_IMAGE_BYTES
        ) {
          await response.body?.cancel();
          return textResult('文件无法下载或超过 5 MiB', true);
        }
        const reader = response.body.getReader();
        const chunks = [];
        let size = 0;
        try {
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            size += value.length;
            if (size > MAX_IMAGE_BYTES) return textResult('文件超过 5 MiB', true);
            chunks.push(value);
          }
        } finally {
          await reader.cancel().catch(() => {});
          reader.releaseLock();
        }
        cancellation.throwIfAborted();
        const { root, key } = target;
        const result = await runFileAction(
          root,
          {
            action: 'write',
            path: key,
            data: Buffer.concat(chunks).toString('base64'),
            writable: true,
          },
          cancellation,
        );
        return result.error ? textResult(result.error, true) : textResult(`${root.name}/${key}`);
      } catch {
        return textResult('无法下载或保存文件', true);
      }
    },
  };
}

export function scopedFileTools(meta: SessionRow): ToolDefinition[] {
  const mode = executionMode(meta);
  const owner = ownerRow(meta);
  const directories = scopedDirectories(owner);
  if (!directories.length || mode === 'full') return [];
  const createTool = (
    action: Action,
    description: string,
    properties: Record<string, object>,
    required: string[],
  ): ToolDefinition => ({
    name: action,
    label: action,
    description,
    parameters: { type: 'object', properties, required } as unknown as ToolDefinition['parameters'],
    async execute(_id, params: FileRequest, signal) {
      const cancellation = signal ?? new AbortController().signal;
      if (cancellation.aborted) return textResult('操作已取消', true);
      if (
        params.path &&
        !directories[0]?.remote &&
        absoluteLocalPath(params.path) &&
        (action === 'read' || action === 'ls')
      ) {
        const mime = action === 'read' ? imageMimeOf(params.path) : null;
        const result = await externalRead(
          params.path,
          action,
          mime ? MAX_IMAGE_BYTES : MAX_TEXT_BYTES,
          cancellation,
        );
        if (result.error) return textResult(result.error, true);
        if (action === 'ls') return textResult(JSON.stringify(result.entries ?? []));
        return readResult(result, mime);
      }
      if (
        mode === 'auto-approval' &&
        params.path &&
        !directories[0]?.remote &&
        absoluteLocalPath(params.path) &&
        (action === 'write' || action === 'edit' || action === 'mkdir' || action === 'delete')
      ) {
        const project = directories.find(({ name }) => name === '/project');
        const key = project && relative(project.host, params.path);
        if (project && key && !isAbsolute(key) && key !== '..' && !key.startsWith(`..${sep}`)) {
          params = { ...params, path: `/project/${key.replaceAll('\\', '/')}` };
        } else {
          return externalChange(owner.id, action, { ...params, path: params.path }, cancellation);
        }
      }
      let target: ReturnType<typeof targetPath>;
      try {
        target = targetPath(params.path ?? '.', directories);
      } catch {
        return textResult('路径超出聊天授权目录', true);
      }
      const { root, key } = target;
      const visible = key === '.' ? root.name : `${root.name}/${key}`;
      const writable =
        action === 'write' || action === 'edit' || action === 'mkdir' || action === 'delete';
      const content = action === 'edit' ? params.newText : params.content;
      if (
        writable &&
        (Buffer.byteLength(content ?? '') > MAX_IMAGE_BYTES ||
          Buffer.byteLength(params.oldText ?? '') > MAX_IMAGE_BYTES ||
          key === '.')
      )
        return textResult('请选择有名称的文件，内容上限为 5 MB', true);
      if (mode === 'approval' && (action === 'write' || action === 'edit')) {
        const approval = await hostPorts().desktop.approveFileChange?.({
          session: owner.id,
          action,
          path: root.remote
            ? `${root.remote.host}: ${posix.join(root.host, key)}`
            : join(root.host, key),
          oldText: params.oldText,
          content,
          grant: { keys: ['file-change'], label: '修改文件' },
          signal: cancellation,
        });
        if (!approval?.approved || cancellation.aborted)
          return textResult(deniedMessage('文件修改未获批准', approval), true);
      }
      if (writable && mode === 'auto-approval' && (root.remote || action === 'delete')) {
        const approval = await hostPorts().desktop.approveToolAction?.({
          session: owner.id,
          title: action === 'delete' ? '删除文件' : '修改 SSH 项目文件',
          fields: [
            {
              label: '路径',
              value: root.remote ? `${root.remote.host}: ${posix.join(root.host, key)}` : visible,
            },
            ...(params.oldText === undefined ? [] : [{ label: '替换前', value: params.oldText }]),
            ...(content === undefined ? [] : [{ label: '内容', value: content }]),
          ],
          ...(action !== 'delete' && { grant: { keys: ['file-change'], label: '修改文件' } }),
          signal: cancellation,
        });
        if (!approval?.approved || cancellation.aborted)
          return textResult(deniedMessage('文件操作未获批准', approval), true);
      }
      const mime = action === 'read' ? imageMimeOf(key) : null;
      const result = await runFileAction(
        root,
        {
          action,
          path: key,
          content,
          oldText: params.oldText,
          pattern: params.pattern,
          limit: mime ? MAX_IMAGE_BYTES : MAX_TEXT_BYTES,
          writable,
        },
        cancellation,
      );
      if (result.error) return textResult(result.error, true);
      if (writable) return textResult(visible);
      if (action === 'ls') return textResult(JSON.stringify(result.entries ?? []));
      if (action === 'find' || action === 'grep') {
        const matches =
          action === 'find'
            ? (result.entries ?? []).map((path) => `${root.name}/${path}`)
            : (result.matches ?? []).map((match) => ({
                ...match,
                path: `${root.name}/${match.path}`,
              }));
        return textResult(JSON.stringify({ matches, limited: Boolean(result.limited) }));
      }
      return readResult(result, mime);
    },
  });
  const path = { type: 'string' };
  const string = { type: 'string' };
  const tools = [
    createTool(
      'read',
      'Read a chat file or use an absolute local path to read an ordinary external file in a local session.',
      { path },
      ['path'],
    ),
    createTool(
      'ls',
      'List up to 1,000 directory entries. Local sessions also accept absolute local paths.',
      { path },
      [],
    ),
    createTool(
      'find',
      'Find names by glob pattern inside a current chat directory.',
      { path, pattern: string },
      ['pattern'],
    ),
    createTool(
      'grep',
      'Find text lines matching a regular expression inside a current chat directory.',
      { path, pattern: string },
      ['pattern'],
    ),
  ];
  if (mode === 'approval' || mode === 'auto-approval')
    tools.push(
      createTool('write', 'Write a file in a current chat directory.', { path, content: string }, [
        'path',
        'content',
      ]),
      createTool(
        'edit',
        'Replace one exact occurrence of text in a current chat file.',
        {
          path,
          oldText: string,
          newText: string,
        },
        ['path', 'oldText', 'newText'],
      ),
    );
  if (mode === 'auto-approval')
    tools.push(
      createTool(
        'mkdir',
        'Create a directory. Outside the working directories, creation requires permission for the parent directory.',
        { path },
        ['path'],
      ),
      createTool('delete', 'Delete one file after approval.', { path }, ['path']),
    );
  return tools;
}
