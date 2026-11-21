import type { ToolDefinition } from '@earendil-works/pi-coding-agent';
import type { RemoteBackend } from '../remote/operations';
import { loadPi } from './pi';

const GREP_MAX_LINE_LENGTH = 500;

const asTool = (definition: unknown): ToolDefinition => definition as ToolDefinition;

export async function remoteGrepTool(cwd: string, backend: RemoteBackend): Promise<ToolDefinition> {
  const pi = await loadPi();
  const base = pi.createGrepToolDefinition(cwd);
  return asTool({
    ...base,
    execute: async (_toolCallId: string, rawParams: unknown, signal?: AbortSignal) => {
      const params = rawParams as {
        pattern: string;
        path?: string;
        glob?: string;
        ignoreCase?: boolean;
        literal?: boolean;
        context?: number;
        limit?: number;
      };
      const result = await backend.search(
        {
          path: params.path && params.path !== '.' ? params.path : cwd,
          pattern: params.pattern,
          glob: params.glob,
          ignoreCase: params.ignoreCase,
          literal: params.literal,
          context: params.context ? Math.max(1, Math.min(params.context, 20)) : 0,
          limit: Math.min(Math.max(params.limit ?? 100, 1), 500),
        },
        signal,
      );
      if (!result.matches.length)
        return {
          content: [{ type: 'text' as const, text: 'No matches found' }],
          details: undefined,
        };
      const output: string[] = [];
      let previous: { path: string; line: number } | null = null;
      for (const match of result.matches) {
        const before = (match.context ?? []).filter((line) => line.line < match.line);
        const after = (match.context ?? []).filter((line) => line.line > match.line);
        const first = before[0]?.line ?? match.line;
        if (previous && (previous.path !== match.path || first > previous.line + 1))
          output.push('--');
        for (const line of before) output.push(`${match.path}-${line.line}- ${line.text}`);
        output.push(
          `${match.path}:${match.line}: ${pi.truncateLine(match.text, GREP_MAX_LINE_LENGTH).text}`,
        );
        for (const line of after) output.push(`${match.path}-${line.line}- ${line.text}`);
        previous = { path: match.path, line: after.at(-1)?.line ?? match.line };
      }
      const truncated = pi.truncateHead(output.join('\n'), {
        maxLines: pi.DEFAULT_MAX_LINES,
        maxBytes: pi.DEFAULT_MAX_BYTES,
      });
      const cut = truncated.truncated || result.truncated;
      const text = cut ? `${truncated.content}\n\n[输出已截断]` : truncated.content;
      return { content: [{ type: 'text' as const, text }], details: undefined };
    },
  });
}

export async function remoteTools(cwd: string, backend: RemoteBackend): Promise<ToolDefinition[]> {
  const pi = await loadPi();
  return [
    pi.createReadToolDefinition(cwd, { operations: backend.read }),
    pi.createWriteToolDefinition(cwd, { operations: backend.write }),
    pi.createEditToolDefinition(cwd, { operations: backend.edit }),
    pi.createBashToolDefinition(cwd, { operations: backend.bash }),
    pi.createLsToolDefinition(cwd, { operations: backend.ls }),
    pi.createFindToolDefinition(cwd, { operations: backend.find }),
    await remoteGrepTool(cwd, backend),
  ].map(asTool);
}
