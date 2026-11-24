import { execFile } from 'node:child_process';
import { isAbsolute, join, relative } from 'node:path';
import { realpathSync } from 'node:fs';
import type { ToolDefinition } from '@earendil-works/pi-coding-agent';
import { hostPorts } from '../../ports';
import { imageMimeOf } from '../../protocol/files';
import { executionMode, ownerRow, scopedDirectories, type ScopedDirectory } from './mode';
import type { SessionRow } from '../session/store';

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_TEXT_BYTES = 200_000;

type FileRequest = { path?: string; content?: string; oldText?: string; newText?: string };
type FileResponse = { data?: string; entries?: string[]; error?: string };
type Action = 'read' | 'ls' | 'write' | 'edit';

function targetPath(input: string, directories: ScopedDirectory[]) {
  const path = input.replaceAll('\\', '/');
  const match = /^\/(privacy|share|project)(?:\/|$)/.exec(path);
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
        /^(con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/i.test(segment),
    )
  )
    throw new Error('路径超出聊天授权目录');
  return { root, key: segments.filter(Boolean).join('/') || '.' };
}

export function scopedReferencePath(meta: SessionRow, input: string): string {
  const { root, key } = targetPath(input, scopedDirectories(meta));
  const path = join(root.host, key);
  const actual = realpathSync(path);
  if (relative(path, actual) !== '' || !isAbsolute(actual)) throw new Error('链接超出聊天授权目录');
  return actual;
}

export function scopedPromptPath(meta: SessionRow, input: string): string | null {
  try {
    const directories = scopedDirectories(meta);
    const virtual = directories.reduce((mapped, { host, name }) => {
      if (!isAbsolute(input)) return mapped;
      const key = relative(host, input).replaceAll('\\', '/');
      if (isAbsolute(key) || key === '..' || key.startsWith('../')) return mapped;
      return key ? `${name}/${key}` : name;
    }, input);
    const { root, key } = targetPath(virtual, directories);
    return key === '.' ? root.name : `${root.name}/${key}`;
  } catch {
    return null;
  }
}

function runFileAction(root: string, request: object, signal: AbortSignal): Promise<FileResponse> {
  const binary = join(
    hostPorts().paths.bundled('scopedfs'),
    process.platform === 'win32' ? 'scopedfs.exe' : 'scopedfs',
  );
  return new Promise((resolve) => {
    const child = execFile(
      binary,
      [root],
      { env: {}, windowsHide: true, signal, timeout: 10_000, maxBuffer: 8 * 1024 * 1024 },
      (error, output) => {
        if (error || signal.aborted) {
          resolve({ error: '文件沙箱无法完成操作' });
          return;
        }
        try {
          resolve(JSON.parse(output) as FileResponse);
        } catch {
          resolve({ error: '文件沙箱返回了无效的响应' });
        }
      },
    );
    child.stdin?.on('error', () => {});
    child.stdin?.end(JSON.stringify(request));
  });
}

const textResult = (text: string, isError = false) => ({
  content: [{ type: 'text' as const, text }],
  details: undefined,
  ...(isError ? { isError: true } : {}),
});

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
      let target: ReturnType<typeof targetPath>;
      try {
        target = targetPath(params.path ?? '.', directories);
      } catch {
        return textResult('路径超出聊天授权目录', true);
      }
      const { root, key } = target;
      const visible = key === '.' ? root.name : `${root.name}/${key}`;
      const writable = action === 'write' || action === 'edit';
      const content = action === 'edit' ? params.newText : params.content;
      if (
        writable &&
        (Buffer.byteLength(content ?? '') > MAX_IMAGE_BYTES ||
          Buffer.byteLength(params.oldText ?? '') > MAX_IMAGE_BYTES ||
          key === '.')
      )
        return textResult('请选择有名称的文件，内容上限为 5 MB', true);
      if (writable && mode === 'approval') {
        const approved = await hostPorts().desktop.approveFileChange?.({
          session: owner.id,
          action,
          path: join(root.host, key),
          signal: cancellation,
        });
        if (!approved || cancellation.aborted) return textResult('文件修改未获批准', true);
      }
      const mime = action === 'read' ? imageMimeOf(key) : null;
      const result = await runFileAction(
        root.host,
        {
          action,
          path: key,
          content,
          oldText: params.oldText,
          limit: mime ? MAX_IMAGE_BYTES : MAX_TEXT_BYTES,
          writable,
        },
        cancellation,
      );
      if (result.error) return textResult(result.error, true);
      if (writable) return textResult(visible);
      if (action === 'ls') return textResult(JSON.stringify(result.entries ?? []));
      if (mime && mime !== 'image/svg+xml')
        return {
          content: [{ type: 'image', data: result.data ?? '', mimeType: mime }],
          details: undefined,
        };
      return textResult(Buffer.from(result.data ?? '', 'base64').toString('utf8'));
    },
  });
  const path = { type: 'string' };
  const string = { type: 'string' };
  const tools = [
    createTool('read', 'Read a file in the current chat directories.', { path }, ['path']),
    createTool('ls', 'List up to 1,000 entries in a current chat directory.', { path }, []),
  ];
  if (mode === 'approval' || mode === 'project-write')
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
  return tools;
}
