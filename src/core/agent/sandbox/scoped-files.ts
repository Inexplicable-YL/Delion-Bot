import { execFile } from 'node:child_process';
import { basename, dirname, isAbsolute, join, parse, posix, relative, sep } from 'node:path';
import { lstatSync, realpathSync } from 'node:fs';
import { isIP } from 'node:net';
import type { ReadToolInput, ToolDefinition } from '@earendil-works/pi-coding-agent';
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
import { commandOutputDirectory } from './command-output';
import type { loadPi } from '../pi';

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_CONTEXT_BYTES = 200_000;

type FileRequest = {
  path?: string;
  content?: string;
  oldText?: string;
  newText?: string;
  pattern?: string;
};
type Action = Exclude<ScopedFileOperation['action'], 'stat' | 'create' | 'read'>;

const virtualRoot = /^\/(privacy|share|project|command-output)(?:\/|$)/;
const commandOutputPath = /^\/command-output\/([a-f0-9-]{36}\.log)$/;
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
  range?: Pick<ScopedFileOperation, 'lineOffset' | 'lineLimit' | 'byteOffset'>,
): Promise<ScopedFileResponse> {
  const protectedPath = externalPathPolicy();
  try {
    signal.throwIfAborted();
    if (protectedPath(input)) throw new Error();
    const path = realpathSync.native(input);
    if (!absoluteLocalPath(path) || protectedPath(path)) throw new Error();
    const result = await runLocalFileAction(
      action === 'ls' ? path : dirname(path),
      { action, path: action === 'ls' ? '.' : basename(path), limit, ...range },
      signal,
    );
    if (action === 'ls' && result.entries)
      result.entries = result.entries.filter((name) => !protectedPath(join(path, name)));
    return result;
  } catch {
    return { error: 'The external path is unavailable or not readable.' };
  }
}

export async function scopedProjectInstructions(project: ScopedDirectory) {
  const path = '/project/AGENTS.md';
  const result = await runFileAction(
    project,
    { action: 'read', path: 'AGENTS.md', limit: MAX_CONTEXT_BYTES },
    AbortSignal.timeout(10_000),
  );
  const content = Buffer.from(result.data ?? '', 'base64')
    .toString('utf8')
    .replace(/^\uFEFF/, '');
  return content.trim() ? [{ path, content }] : [];
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
    throw new Error('The path is outside the chat directories.');
  return { root, key: segments.filter(Boolean).join('/') || '.' };
}

export function scopedReferencePath(meta: SessionRow, input: string): string {
  const { root, key } = targetPath(input, scopedDirectories(meta));
  if (root.remote) return posix.join(root.host, key);
  const path = join(root.host, key);
  const actual = realpathSync(path);
  if (relative(path, actual) !== '' || !isAbsolute(actual))
    throw new Error('The link is outside the chat directories.');
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
      return { error: 'The remote file sandbox could not complete the operation.' };
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
          resolve({ error: 'The file sandbox could not complete the operation.' });
          return;
        }
        try {
          resolve(JSON.parse(output) as ScopedFileResponse);
        } catch {
          resolve({ error: 'The file sandbox returned an invalid response.' });
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

export type CommandInspection = Pick<
  ScopedFileOperation,
  'pattern' | 'glob' | 'maxDepth' | 'filesOnly' | 'skipHidden' | 'limit'
> & { action: 'read' | 'ls' | 'find' | 'grep' };

export function inspectCommandPath(
  directories: ScopedDirectory[],
  input: string,
  request: CommandInspection,
  signal: AbortSignal,
): Promise<ScopedFileResponse> {
  if (
    !directories[0]?.remote &&
    absoluteLocalPath(input) &&
    (request.action === 'read' || request.action === 'ls')
  )
    return externalRead(input, request.action, request.limit ?? MAX_IMAGE_BYTES, signal);
  const { root, key } = targetPath(input, directories);
  return runFileAction(root, { limit: MAX_IMAGE_BYTES, ...request, path: key }, signal);
}

export function commandCopyTarget(directories: ScopedDirectory[], destination: string) {
  try {
    const { root, key } = targetPath(destination, directories);
    return root.remote ? null : { root, key };
  } catch {
    return null;
  }
}

export async function copyCommandFile(
  directories: ScopedDirectory[],
  source: string,
  { root, key }: NonNullable<ReturnType<typeof commandCopyTarget>>,
  signal: AbortSignal,
) {
  const read = await inspectCommandPath(directories, source, { action: 'read' }, signal);
  if (read.error) return read;
  const stat = await runFileAction(root, { action: 'stat', path: key }, signal);
  if (stat.kind === 'directory')
    key = posix.join(key, posix.basename(source.replaceAll('\\', '/')));
  const original = commandCopyTarget(directories, source);
  if (original?.root === root && original.key === key)
    return { error: 'The source and destination are the same file.' };
  const checked = targetPath(`${root.name}/${key}`, directories);
  return writeCommandFile(
    { root, key: checked.key },
    Buffer.from(read.data ?? '', 'base64'),
    signal,
  );
}

export function writeCommandFile(
  { root, key }: NonNullable<ReturnType<typeof commandCopyTarget>>,
  bytes: Buffer,
  signal: AbortSignal,
) {
  signal.throwIfAborted();
  return runFileAction(
    root,
    {
      action: 'write',
      path: key,
      data: bytes.toString('base64'),
      writable: true,
    },
    signal,
  );
}

const textResult = (text: string, isError = false) => ({
  content: [{ type: 'text' as const, text }],
  details: undefined,
  ...(isError ? { isError: true } : {}),
});

function readPageResult(result: ScopedFileResponse) {
  const text = Buffer.from(result.data ?? '', 'base64').toString('utf8');
  const next = result.nextOffset
    ? { offset: result.nextOffset }
    : result.nextByteOffset
      ? { byteOffset: result.nextByteOffset }
      : null;
  if (!next) return { ...textResult(text), structuredContent: text };
  return {
    content: [
      {
        type: 'text' as const,
        text: `[Read metadata: pass ${JSON.stringify(next)} with the same path to continue. File content follows.]`,
      },
      { type: 'text' as const, text },
    ],
    details: { next },
    structuredContent: text,
  };
}

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
    return textResult('The external path is unavailable or not writable.', true);
  }
  const create = operation === 'create' || operation === 'mkdir';
  const data = operation === 'edit' ? newText : content;
  if (
    Buffer.byteLength(data ?? '') > MAX_IMAGE_BYTES ||
    Buffer.byteLength(oldText ?? '') > MAX_IMAGE_BYTES
  )
    return textResult('Content is limited to 5 MB.', true);
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
    return textResult(deniedMessage('File operation not approved', approval), true);
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
        return textResult(
          'Provide a public HTTPS address and a destination inside the available chat directory.',
          true,
        );
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
          return textResult('The file cannot be downloaded or exceeds 5 MiB.', true);
        }
        const reader = response.body.getReader();
        const chunks = [];
        let size = 0;
        try {
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            size += value.length;
            if (size > MAX_IMAGE_BYTES) return textResult('The file exceeds 5 MiB.', true);
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
        return textResult('Unable to download or save the file.', true);
      }
    },
  };
}

export function scopedFileTools(
  meta: SessionRow,
  pi: Awaited<ReturnType<typeof loadPi>>,
): ToolDefinition[] {
  const mode = executionMode(meta);
  const owner = ownerRow(meta);
  const directories = scopedDirectories(owner);
  if (mode === 'full') return [];
  const cwd = directories[0]?.name ?? '/command-output';
  const nativeRead = pi.createReadToolDefinition(cwd);
  const read = {
    ...nativeRead,
    description: directories.length
      ? 'Read text, an image, or a command output file. Use offset and limit to read text by line. Local sessions also accept absolute paths for ordinary external files.'
      : 'Read a command output file from this session using its full_output_path.',
    parameters: {
      ...nativeRead.parameters,
      properties: {
        ...nativeRead.parameters.properties,
        offset: { ...nativeRead.parameters.properties.offset, type: 'integer', minimum: 1 },
        limit: { ...nativeRead.parameters.properties.limit, type: 'integer', minimum: 1 },
        byteOffset: {
          type: 'integer',
          minimum: 0,
          description:
            'Read a page starting at this zero-based byte offset in place of offset and limit.',
        },
      },
    },
    async execute(id, params: ReadToolInput & { byteOffset?: number }, signal, onUpdate, context) {
      const cancellation = signal ?? new AbortController().signal;
      if (cancellation.aborted) return textResult('The operation was cancelled.', true);
      const mime = imageMimeOf(params.path);
      const image = mime && mime !== 'image/svg+xml';
      const range = !image
        ? params.byteOffset == null
          ? { lineOffset: params.offset ?? 1, lineLimit: params.limit ?? pi.DEFAULT_MAX_LINES }
          : { byteOffset: params.byteOffset }
        : undefined;
      const limit = image ? MAX_IMAGE_BYTES : pi.DEFAULT_MAX_BYTES;
      const commandOutput = commandOutputPath.exec(params.path);
      let result: ScopedFileResponse;
      if (commandOutput) {
        try {
          result = await runLocalFileAction(
            realpathSync(commandOutputDirectory(owner.id)),
            { action: 'read', path: commandOutput[1]!, limit, ...range },
            cancellation,
          );
        } catch {
          return textResult('This session has no such command output file.', true);
        }
      } else if (directories.length && !directories[0]?.remote && absoluteLocalPath(params.path)) {
        result = await externalRead(params.path, 'read', limit, cancellation, range);
      } else {
        let target: ReturnType<typeof targetPath>;
        try {
          target = targetPath(params.path, directories);
        } catch {
          return textResult('The path is outside the chat directories.', true);
        }
        result = await runFileAction(
          target.root,
          { action: 'read', path: target.key, limit, ...range },
          cancellation,
        );
      }
      if (result.error) return textResult(result.error, true);
      if (image) {
        const imageReader = pi.createReadToolDefinition(cwd, {
          operations: {
            access: async () => cancellation.throwIfAborted(),
            readFile: async () => Buffer.from(result.data ?? '', 'base64'),
            detectImageMimeType: async () => mime,
          },
        });
        return imageReader.execute(id, { path: 'image' }, cancellation, onUpdate, context);
      }
      return readPageResult(result);
    },
  } as ToolDefinition;
  if (!directories.length) return [read];
  const createTool = (
    action: Action,
    description: string,
    parameters: ToolDefinition['parameters'],
  ): ToolDefinition => ({
    name: action,
    label: action,
    description,
    parameters,
    async execute(_id, params: FileRequest, signal) {
      const cancellation = signal ?? new AbortController().signal;
      if (cancellation.aborted) return textResult('The operation was cancelled.', true);
      if (
        params.path &&
        !directories[0]?.remote &&
        absoluteLocalPath(params.path) &&
        action === 'ls'
      ) {
        const result = await externalRead(params.path, action, pi.DEFAULT_MAX_BYTES, cancellation);
        if (result.error) return textResult(result.error, true);
        return textResult(JSON.stringify(result.entries ?? []));
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
        return textResult('The path is outside the chat directories.', true);
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
        return textResult('Choose a named file. Content is limited to 5 MB.', true);
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
          return textResult(deniedMessage('File change not approved', approval), true);
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
          return textResult(deniedMessage('File operation not approved', approval), true);
      }
      const result = await runFileAction(
        root,
        {
          action,
          path: key,
          content,
          oldText: params.oldText,
          pattern: params.pattern,
          writable,
        },
        cancellation,
      );
      if (result.error) return textResult(result.error, true);
      if (writable) return textResult(visible);
      if (action === 'ls') return textResult(JSON.stringify(result.entries ?? []));
      const matches =
        action === 'find'
          ? (result.entries ?? []).map((path) => `${root.name}/${path}`)
          : (result.matches ?? []).map((match) => ({
              ...match,
              path: `${root.name}/${match.path}`,
            }));
      return textResult(
        JSON.stringify({
          matches,
          limited: Boolean(result.limited),
          ...(result.skippedFiles && { skippedFiles: result.skippedFiles }),
        }),
      );
    },
  });
  const path = { type: 'string' };
  const string = { type: 'string' };
  const parameters = (properties: Record<string, object>, required: string[]) =>
    ({ type: 'object', properties, required }) as unknown as ToolDefinition['parameters'];
  const tools = [
    read,
    createTool(
      'ls',
      'List up to 1,000 directory entries. Local sessions also accept absolute local paths.',
      parameters({ path }, []),
    ),
    createTool(
      'find',
      'Find names by glob pattern inside a current chat directory.',
      parameters({ path, pattern: string }, ['pattern']),
    ),
    createTool(
      'grep',
      'Find text matching a regular expression. If limited is true, some content was not searched or returned.',
      parameters({ path, pattern: string }, ['pattern']),
    ),
  ];
  if (mode === 'approval' || mode === 'auto-approval') {
    const nativeWrite = pi.createWriteToolDefinition(cwd);
    tools.push(
      {
        ...nativeWrite,
        ...createTool('write', 'Write a file in a current chat directory.', nativeWrite.parameters),
      } as ToolDefinition,
      createTool(
        'edit',
        'Replace one exact occurrence of text in a current chat file.',
        parameters({ path, oldText: string, newText: string }, ['path', 'oldText', 'newText']),
      ),
    );
  }
  if (mode === 'auto-approval')
    tools.push(
      createTool(
        'mkdir',
        'Create a directory. Outside the working directories, creation requires permission for the parent directory.',
        parameters({ path }, ['path']),
      ),
      createTool('delete', 'Delete one file after approval.', parameters({ path }, ['path'])),
    );
  return tools;
}
