import type {
  McpConnectionStatus,
  McpServerInput,
  McpServerPatch,
  McpTransportConfig,
} from '../../../../core/protocol/capabilities';

function parseArgsText(text: string): string[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

export function parseEnvText(text: string): {
  pairs: Record<string, string>;
  error: string | null;
} {
  const pairs: Record<string, string> = {};
  const lines = text.split('\n');
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]!.trim();
    if (!line) continue;
    const at = line.indexOf('=');
    const key = at < 0 ? '' : line.slice(0, at).trim();
    if (!key) return { pairs, error: `环境变量第 ${index + 1} 行应为 KEY=VALUE 格式` };
    pairs[key] = line.slice(at + 1).trim();
  }
  return { pairs, error: null };
}

export interface McpFormInput {
  transport: McpTransportConfig['transport'];
  name: string;
  command: string;
  argsText: string;
  envText: string;
  url: string;
  headers: readonly { name: string; value: string }[];
}

export type McpFormParsed = { ok: true; value: McpServerInput } | { ok: false; error: string };

export function parseMcpForm(input: McpFormInput, options: { isEdit: boolean }): McpFormParsed {
  const name = input.name.trim();
  if (!name) return { ok: false, error: '名称不能为空' };
  if (/\s/.test(name)) return { ok: false, error: '名称不能包含空格' };
  if (input.transport === 'http') {
    const url = input.url.trim();
    if (!url && !options.isEdit) return { ok: false, error: '地址不能为空' };
    if (url && !/^https?:$/.test(URL.parse(url)?.protocol ?? ''))
      return { ok: false, error: '地址需以 http:// 或 https:// 开头' };
    const headers = input.headers
      .map(({ name, value }) => [name.trim(), value.trim()] as const)
      .filter(([name, value]) => name || value);
    if (headers.some(([name]) => !/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(name))) {
      return { ok: false, error: '请为每个 HTTP 标头填写有效的名称' };
    }
    return {
      ok: true,
      value: { transport: 'http', name, url, headers: Object.fromEntries(headers) },
    };
  }
  const command = input.command.trim();
  if (!command && !options.isEdit) return { ok: false, error: '命令不能为空' };
  const { pairs, error } = parseEnvText(input.envText);
  if (error) return { ok: false, error };
  return {
    ok: true,
    value: { transport: 'stdio', name, command, args: parseArgsText(input.argsText), env: pairs },
  };
}

export function mcpUpdatePatch(value: McpServerInput): McpServerPatch {
  const patch: McpServerPatch = { name: value.name };
  if (value.transport === 'http') {
    if (value.url) patch.url = value.url;
    if (Object.keys(value.headers).length > 0) patch.headers = value.headers;
    return patch;
  }
  if (value.command) patch.command = value.command;
  if (value.args.length > 0) patch.args = value.args;
  if (Object.keys(value.env).length > 0) patch.env = value.env;
  return patch;
}

export interface McpStatusBadge {
  label: string;
  dotClass: string;
  spin: boolean;
}

export function mcpStatusBadge(
  status: McpConnectionStatus,
  toolCount: number | null,
): McpStatusBadge {
  switch (status) {
    case 'connecting':
      return { label: '连接中', dotClass: 'text-ink-3', spin: true };
    case 'connected':
      return {
        label: toolCount === null ? '已连接' : `已连接 · ${toolCount} 个工具`,
        dotClass: 'bg-success',
        spin: false,
      };
    case 'disconnected':
      return { label: '未连接', dotClass: 'bg-ink-3/40', spin: false };
    case 'error':
      return { label: '连接失败', dotClass: 'bg-danger', spin: false };
  }
}
