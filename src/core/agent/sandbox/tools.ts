import type { ToolDefinition } from '@earendil-works/pi-coding-agent';
import { loadPi } from '../pi';
import { runSandboxed, type SandboxRunOptions } from './linux';
import type { SandboxRoots } from './mode';
import { sandboxPath, scrubText } from './paths';

const READ_LIMIT = 200_000;
const parameters = (properties: object, required: string[]) =>
  ({ type: 'object', properties, required }) as unknown as ToolDefinition['parameters'];

const textResult = (text: string, isError = false) => ({
  content: [{ type: 'text' as const, text }],
  details: undefined,
  ...(isError ? { isError: true } : {}),
});

function visible(roots: SandboxRoots, value: string): string {
  return scrubText(value, roots.conceal);
}

async function python(
  roots: SandboxRoots,
  script: string,
  args: string[],
  options: SandboxRunOptions = {},
) {
  return runSandboxed(roots, '/usr/bin/python3', ['-c', script, ...args], options);
}

const READ_SCRIPT = `
import sys
path, limit = sys.argv[1], int(sys.argv[2])
with open(path, 'rb') as handle:
    sys.stdout.buffer.write(handle.read(limit + 1))
`;

const WRITE_SCRIPT = `
import os, sys
path = sys.argv[1]
parent = os.path.dirname(path)
if parent:
    os.makedirs(parent, exist_ok=True)
with open(path, 'wb') as handle:
    handle.write(sys.stdin.buffer.read())
`;

function imageMime(path: string): string | null {
  const lower = path.toLowerCase();
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  if (lower.endsWith('.gif')) return 'image/gif';
  if (lower.endsWith('.webp')) return 'image/webp';
  if (lower.endsWith('.bmp')) return 'image/bmp';
  return null;
}

export async function sandboxBash(
  roots: SandboxRoots,
  command: string,
  options: SandboxRunOptions = {},
): Promise<{ code: number; text: string }> {
  const wrapped = ['mkdir -p /privacy/.home /privacy/.cache /tmp', 'cd /privacy', command].join(
    '\n',
  );
  const result = await runSandboxed(roots, '/usr/bin/bash', ['-c', wrapped], {
    ...options,
    cwd: '/privacy',
    onData: undefined,
  });
  const text = visible(roots, `${result.stdout.toString('utf8')}${result.stderr}`);
  options.onData?.(Buffer.from(text));
  const status =
    result.code === 0
      ? text || '(no output)'
      : `${text}\n\nCommand exited with code ${result.code}`;
  return { code: result.code, text: result.truncated ? `${status}\n\n[输出已截断]` : status };
}

export async function sandboxBashTool(
  roots: SandboxRoots,
  withBackground = false,
): Promise<ToolDefinition> {
  const pi = await loadPi();
  const bash = pi.createBashToolDefinition('/privacy', { shellPath: '/usr/bin/bash' });
  const schema = bash.parameters as unknown as { properties: Record<string, unknown> };
  return {
    ...bash,
    description:
      'Run a command in the sandbox. The working directory is /privacy. /privacy and /delivery are writable. Other visible files are read-only. Network and host services are unavailable.',
    parameters: {
      ...schema,
      properties: {
        ...schema.properties,
        ...(withBackground
          ? {
              background: {
                type: 'boolean',
                description: 'Set to true to return taskId immediately.',
              },
            }
          : {}),
      },
    } as unknown as ToolDefinition['parameters'],
    async execute(
      _id,
      params: { command: string; timeout?: number; background?: boolean },
      signal,
    ) {
      if (params.background) return textResult('background');
      const result = await sandboxBash(roots, params.command, {
        signal,
        timeoutMs: params.timeout ? params.timeout * 1000 : undefined,
      });
      return textResult(result.text, result.code !== 0);
    },
  } as ToolDefinition;
}

export async function sandboxTools(roots: SandboxRoots): Promise<ToolDefinition[]> {
  const bash = await sandboxBashTool(roots);
  const read: ToolDefinition = {
    name: 'read',
    label: 'read',
    description:
      'Read a file. Use /privacy and /delivery for this session. Other files must be real absolute paths and are read-only.',
    parameters: parameters(
      {
        path: { type: 'string' },
        offset: { type: 'number' },
        limit: { type: 'number' },
      },
      ['path'],
    ),
    async execute(_id, params: { path: string; offset?: number; limit?: number }) {
      const target = sandboxPath(params.path);
      const mime = imageMime(target);
      const result = await python(roots, READ_SCRIPT, [
        target,
        String(mime ? 5_000_000 : READ_LIMIT),
      ]);
      if (result.code !== 0) return textResult(visible(roots, result.stderr || '读取失败'), true);
      if (mime)
        return {
          content: [
            { type: 'text', text: `Read image file [${mime}]` },
            { type: 'image', data: result.stdout.toString('base64'), mimeType: mime },
          ],
          details: undefined,
        };
      const body = result.stdout.toString('utf8');
      const lines = body.split('\n');
      const start = Math.max(0, (params.offset ?? 1) - 1);
      const selected = lines
        .slice(start, params.limit ? start + params.limit : undefined)
        .join('\n');
      return textResult(visible(roots, selected));
    },
  };
  const write: ToolDefinition = {
    name: 'write',
    label: 'write',
    description:
      'Write a file under /privacy or /delivery. Writes outside those directories are rejected by the sandbox.',
    parameters: parameters({ path: { type: 'string' }, content: { type: 'string' } }, [
      'path',
      'content',
    ]),
    async execute(_id, params: { path: string; content: string }) {
      const target = sandboxPath(params.path);
      const result = await python(roots, WRITE_SCRIPT, [target], {
        stdin: Buffer.from(params.content),
      });
      if (result.code !== 0) return textResult(visible(roots, result.stderr || '写入失败'), true);
      return textResult(`Wrote ${target}`);
    },
  };
  const edit: ToolDefinition = {
    name: 'edit',
    label: 'edit',
    description: 'Replace one exact occurrence of text in a file under /privacy or /delivery.',
    parameters: parameters(
      { path: { type: 'string' }, oldText: { type: 'string' }, newText: { type: 'string' } },
      ['path', 'oldText', 'newText'],
    ),
    async execute(_id, params: { path: string; oldText: string; newText: string }) {
      const target = sandboxPath(params.path);
      const current = await python(roots, READ_SCRIPT, [target, String(READ_LIMIT)]);
      if (current.code !== 0) return textResult(visible(roots, current.stderr || '读取失败'), true);
      const source = current.stdout.toString('utf8');
      const found = source.split(params.oldText).length - 1;
      if (found !== 1)
        return textResult(found === 0 ? '文本不存在' : `文本出现了 ${found} 次`, true);
      const next = source.replace(params.oldText, params.newText);
      const written = await python(roots, WRITE_SCRIPT, [target], { stdin: Buffer.from(next) });
      if (written.code !== 0) return textResult(visible(roots, written.stderr || '写入失败'), true);
      return textResult(`Edited ${target}`);
    },
  };
  const command = (
    name: string,
    description: string,
    run: (path: string, pattern?: string) => string[],
  ) =>
    ({
      name,
      label: name,
      description,
      parameters: parameters(
        { path: { type: 'string' }, pattern: { type: 'string' } },
        name === 'ls' ? [] : ['pattern'],
      ),
      async execute(_id, params: { path?: string; pattern?: string }) {
        const target = sandboxPath(params.path ?? '/privacy');
        const argv = run(target, params.pattern);
        const result = await runSandboxed(roots, argv[0]!, argv.slice(1));
        const output = visible(roots, `${result.stdout.toString('utf8')}${result.stderr}`);
        return textResult(
          output || (result.code === 0 ? '(no output)' : '命令失败'),
          result.code !== 0,
        );
      },
    }) as ToolDefinition;
  return [
    read,
    write,
    edit,
    bash,
    command(
      'grep',
      'Search file contents. Defaults to /privacy. Pattern is literal unless it is a regular expression accepted by grep -E.',
      (path, pattern = '') => ['/usr/bin/grep', '-R', '-n', '-E', '--', pattern, path],
    ),
    command('find', 'Find files by name. Defaults to /privacy.', (path, pattern = '*') => [
      '/usr/bin/find',
      path,
      '-name',
      pattern,
    ]),
    command('ls', 'List a directory. Defaults to /privacy.', (path) => [
      '/usr/bin/ls',
      '-la',
      path,
    ]),
  ];
}
