import { createHash } from 'node:crypto';
import { fetchPublicWebPage } from '../../capabilities/public-web-fetch';
import type { ScopedCommandResult } from '../../remote/helper';
import { approveNonPublicRead } from './approve-tool';
import { literalPipelines } from './command-names';
import type { ScopedDirectory } from './mode';
import { inspectCommandPath, type CommandInspection } from './scoped-files';
import { runVcsReads, vcsReadCommand } from './read-vcs';

type Stage =
  | {
      kind: 'inspect';
      paths: string[];
      request: CommandInspection;
      namesOnly?: boolean;
      numbers?: boolean;
    }
  | { kind: 'text'; command: string; path?: string; option?: string; count?: number }
  | { kind: 'vcs'; read: NonNullable<ReturnType<typeof vcsReadCommand>> }
  | { kind: 'http'; url: URL; head: boolean; follow: boolean; fail: boolean }
  | { kind: 'hash'; paths: string[] }
  | { kind: 'json'; path?: string; fields: string[]; raw: boolean }
  | { kind: 'lines'; path?: string; first: number; last: number }
  | { kind: 'filter'; pattern: string; insensitive: boolean }
  | { kind: 'pwd' };

function searchStage(program: string, args: string[]): Stage | null {
  let glob: string | undefined;
  let hidden = program === 'grep';
  let files = false;
  let namesOnly = false;
  let numbers = program === 'rg';
  let insensitive = false;
  let fixed = false;
  let operandsOnly = false;
  const operands: string[] = [];
  for (let index = 0; index < args.length; index++) {
    const arg = args[index]!;
    if (!operandsOnly && arg === '--') operandsOnly = true;
    else if (operandsOnly || !arg.startsWith('-')) operands.push(arg);
    else if (program === 'rg' && arg === '--files') files = true;
    else if (program === 'rg' && arg === '--hidden') hidden = true;
    else if (program === 'rg' && (arg === '-g' || arg === '--glob') && !glob) {
      glob = args[++index];
      if (!glob) return null;
    } else if (arg === '--ignore-case') insensitive = true;
    else if (arg === '--fixed-strings') fixed = true;
    else if (arg === '--line-number') numbers = true;
    else if (arg === '--files-with-matches') namesOnly = true;
    else if (/^-[rEFinHl]+$/.test(arg)) {
      insensitive ||= arg.includes('i');
      fixed ||= arg.includes('F');
      numbers ||= arg.includes('n');
      namesOnly ||= arg.includes('l');
    } else return null;
  }
  if (glob !== undefined && (!glob || /[/\\!{}]/.test(glob) || glob.length > 512)) return null;
  const paths = files ? operands : operands.slice(1);
  let pattern = files ? (glob ?? '*') : operands[0];
  if (!pattern || pattern.length > 512 || paths.length > 8) return null;
  if (!files) {
    if (fixed) pattern = pattern.replace(/[.*+?^{}$()|[\]\\]/g, '\\$&');
    if (insensitive) pattern = '(?i)' + pattern;
  }
  return {
    kind: 'inspect',
    paths: paths.length ? paths : ['.'],
    request: {
      action: files ? 'find' : 'grep',
      pattern,
      glob: files ? undefined : glob,
      filesOnly: files,
      skipHidden: !hidden,
    },
    namesOnly,
    numbers,
  };
}

function findStage(args: string[]): Stage | null {
  const paths = [args[0] && !args[0].startsWith('-') ? args.shift()! : '.'];
  let pattern = '*';
  let maxDepth: number | undefined;
  let filesOnly = false;
  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    const value = args[i + 1];
    if (flag === '-print') continue;
    if (flag === '-name' && value && !/[/\\]/.test(value)) pattern = value;
    else if (flag === '-maxdepth' && value && /^\d{1,3}$/.test(value)) maxDepth = Number(value);
    else if (flag === '-type' && value === 'f') filesOnly = true;
    else return null;
    i++;
  }
  return { kind: 'inspect', paths, request: { action: 'find', pattern, maxDepth, filesOnly } };
}

function httpStage(program: string, args: string[]): Stage | null {
  let url: URL | undefined;
  let head = false;
  let follow = program === 'wget';
  let fail = program === 'wget';
  let toStdout = program === 'curl';
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (program === 'wget' && (arg === '-qO-' || arg === '-O-' || arg === '--output-document=-'))
      toStdout = true;
    else if (program === 'wget' && arg === '-O' && args[i + 1] === '-') {
      i++;
      toStdout = true;
    } else if (
      program === 'curl' &&
      (arg === '--request' || arg === '-X') &&
      args[i + 1] === 'GET'
    ) {
      i++;
    } else if (program === 'curl' && /^-[sSLfI]+$/.test(arg)) {
      head ||= arg.includes('I');
      follow ||= arg.includes('L');
      fail ||= arg.includes('f');
    } else if (program === 'curl' && arg === '--head') head = true;
    else if (program === 'curl' && arg === '--location') follow = true;
    else if (program === 'curl' && arg === '--fail') fail = true;
    else if (['--quiet', '-q'].includes(arg) && program === 'wget') continue;
    else if (['--silent', '--show-error'].includes(arg) && program === 'curl') continue;
    else if (!url && !arg.startsWith('-')) {
      try {
        url = new URL(arg);
      } catch {
        return null;
      }
      if (!/^https?:$/.test(url.protocol) || url.username || url.password) return null;
    } else return null;
  }
  return url && toStdout ? { kind: 'http', url, head, follow, fail } : null;
}

function parseStage(
  tokens: string[],
  shell: 'bash' | 'cmd',
  root: ScopedDirectory,
  piped: boolean,
): Stage | null {
  const vcs = !piped && vcsReadCommand(tokens, shell, root);
  if (vcs) return { kind: 'vcs', read: vcs };
  let [program, ...args] = tokens;
  if (shell === 'cmd') {
    program = program?.toLowerCase().replace(/\.exe$/, '');
    if (!piped && (program === 'get-content' || program === 'get-childitem')) {
      if (/^-(?:literal)?path$/i.test(args[0] ?? '') && args.length === 2) args.shift();
      if (args.length > 1 || args[0]?.startsWith('-')) return null;
      program = program === 'get-content' ? 'cat' : 'ls';
    }
  } else {
    program = program?.replace(/^\/(?:usr\/)?bin\//, '');
  }
  if (program === 'pwd' && !piped && !args.length) return { kind: 'pwd' };
  if (program === 'jq') {
    const raw = args[0] === '-r' || args[0] === '--raw-output';
    if (raw) args.shift();
    const [query, path] = args;
    if (
      args.length !== (piped ? 1 : 2) ||
      !query ||
      !/^(?:\.|\.[a-zA-Z_]\w*(?:\.[a-zA-Z_]\w*|\[\d+\])*)$/.test(query) ||
      path?.startsWith('-')
    )
      return null;
    return {
      kind: 'json',
      path,
      fields: query
        .slice(1)
        .replace(/\[(\d+)\]/g, '.$1')
        .split('.')
        .filter(Boolean),
      raw,
    };
  }
  if (program === 'sed' && args[0] === '-n') {
    const lineRange = /^([1-9]\d{0,5})(?:,([1-9]\d{0,5}))?p$/.exec(args[1] ?? '');
    if (!lineRange || args.length !== (piped ? 2 : 3) || args[2]?.startsWith('-')) return null;
    return {
      kind: 'lines',
      path: args[2],
      first: Number(lineRange[1]),
      last: Number(lineRange[2] ?? lineRange[1]),
    };
  }
  if (program === 'rg' || program === 'grep') {
    if (!piped) return searchStage(program, args);
    const pattern = args.at(-1);
    const flags = args.slice(0, -1);
    if (!pattern || pattern.startsWith('-') || flags.some((flag) => !/^-[Fi]+$/.test(flag)))
      return null;
    if (!flags.some((flag) => flag.includes('F')) && /[.*+?^$(){}[\]\\]/.test(pattern)) return null;
    return { kind: 'filter', pattern, insensitive: flags.some((flag) => flag.includes('i')) };
  }
  if (program === 'find' && shell === 'bash') return !piped ? findStage(args) : null;
  if (program === 'curl' || program === 'wget')
    return !piped && !root.remote ? httpStage(program, args) : null;
  if (
    !piped &&
    program === 'fd' &&
    args.length === 2 &&
    /^-e$|^--extension$/.test(args[0]!) &&
    /^\w+$/.test(args[1]!)
  )
    return {
      kind: 'inspect',
      paths: ['.'],
      request: { action: 'find', pattern: '*.' + args[1], filesOnly: true, skipHidden: true },
    };
  if (!piped && (program === 'ls' || (shell === 'cmd' && program === 'dir'))) {
    const paths = args.filter((arg) =>
      program === 'dir' ? !/^\/b$/i.test(arg) : !/^-[aA1]+$/.test(arg),
    );
    return paths.length <= 1 && !paths[0]?.startsWith('-')
      ? { kind: 'inspect', paths: paths.length ? paths : ['.'], request: { action: 'ls' } }
      : null;
  }
  if (
    !piped &&
    (program === 'sha256sum' || (program === 'shasum' && args[0] === '-a' && args[1] === '256'))
  ) {
    const paths = program === 'shasum' ? args.slice(2) : args;
    return paths.length && paths.length <= 8 && paths.every((path) => !path.startsWith('-'))
      ? { kind: 'hash', paths }
      : null;
  }
  if (!piped && (program === 'cat' || (shell === 'cmd' && program === 'type'))) {
    if (args[0] === '--') args = args.slice(1);
    return args.length && args.length <= 8 && args.every((path) => !path.startsWith('-'))
      ? { kind: 'inspect', paths: args, request: { action: 'read' } }
      : null;
  }
  if (!program || !['head', 'tail', 'wc', 'sort', 'uniq'].includes(program)) return null;
  let count = 10;
  let option: string | undefined;
  if (program === 'head' || program === 'tail') {
    if (args[0] === '-n' || args[0] === '--lines') {
      if (!/^\d{1,6}$/.test(args[1] ?? '')) return null;
      count = Number(args[1]);
      args = args.slice(2);
    } else if (/^-\d{1,6}$/.test(args[0] ?? '')) count = Number(args.shift()!.slice(1));
  } else {
    const accepted = { wc: /^-[lwmc]$/, sort: /^-[nru]+$/, uniq: /^-[cd]$/ };
    if (accepted[program as keyof typeof accepted].test(args[0] ?? '')) option = args.shift();
  }
  if (args[0] === '--') args = args.slice(1);
  if (piped ? args.length > 0 : args.length !== 1 || args[0]!.startsWith('-')) return null;
  return { kind: 'text', command: program, path: args[0], count, option };
}

export function commandPlan(command: string, shell: 'bash' | 'cmd', root: ScopedDirectory) {
  const pipelines = literalPipelines(command, shell);
  if (!pipelines) return null;
  const stages = pipelines.map((pipeline) =>
    pipeline.map((tokens, index) => parseStage(tokens, shell, root, index > 0)),
  );
  return stages.every((pipeline) => pipeline.every((stage) => stage !== null))
    ? (stages as Stage[][])
    : null;
}

const maxOutput = 128 * 1024;

async function httpOutput(
  { url, head, follow, fail }: Extract<Stage, { kind: 'http' }>,
  session: string,
  signal: AbortSignal,
) {
  for (let hops = 0; hops <= 5; hops++) {
    if (!/^https?:$/.test(url.protocol) || url.username || url.password)
      throw new Error('仅支持无凭据的 HTTP 或 HTTPS 地址');
    const response = await fetchPublicWebPage(
      url,
      { method: head ? 'HEAD' : 'GET', redirect: 'manual', credentials: 'omit', signal },
      (target) => approveNonPublicRead(session, target, signal),
    );
    const redirect =
      response.status >= 300 && response.status < 400 && response.headers.get('location');
    if (follow && redirect) {
      await response.body?.cancel();
      url = new URL(redirect, url);
      continue;
    }
    if (fail && !response.ok) {
      await response.body?.cancel();
      return { exitCode: 22, output: '', error: 'HTTP ' + response.status };
    }
    if (head)
      return {
        exitCode: 0,
        output: [
          'HTTP ' + response.status,
          ...[...response.headers].map(([name, value]) => name + ': ' + value),
          '',
          '',
        ].join('\r\n'),
      };
    if (!response.body) return { exitCode: 0, output: '' };
    const reader = response.body.getReader();
    const chunks = [];
    let bytes = 0;
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) return { exitCode: 0, output: Buffer.concat(chunks).toString('utf8') };
        const room = maxOutput - bytes;
        chunks.push(value.subarray(0, room));
        bytes += value.length;
        if (bytes > maxOutput)
          return { exitCode: 0, output: Buffer.concat(chunks).toString('utf8') + '\n[输出已截断]' };
      }
    } finally {
      await reader.cancel().catch(() => {});
    }
  }
  throw new Error('网页重定向次数过多');
}

function textOutput(stage: Extract<Stage, { kind: 'text' }>, data: string): string {
  const { command, option = '', count = 10 } = stage;
  const lines = data.match(/[^\n]*\n|[^\n]+$/g) ?? [];
  if (command === 'head') return lines.slice(0, count).join('');
  if (command === 'tail') return count ? lines.slice(-count).join('') : '';
  if (command === 'wc') {
    const lineCount = lines.filter((line) => line.endsWith('\n')).length;
    const words = data.match(/\S+/gu)?.length ?? 0;
    const size = Buffer.byteLength(data);
    const values = { '-l': lineCount, '-w': words, '-c': size, '-m': Array.from(data).length };
    return (
      (option ? values[option as keyof typeof values] : [lineCount, words, size].join(' ')) + '\n'
    );
  }
  const content = lines.map((line) => line.replace(/\r?\n$/, ''));
  if (command === 'sort') {
    content.sort(
      option.includes('n') ? (a, b) => (parseFloat(a) || 0) - (parseFloat(b) || 0) : undefined,
    );
    if (option.includes('r')) content.reverse();
    const values = option.includes('u') ? [...new Set(content)] : content;
    return values.map((line) => line + '\n').join('');
  }
  const result = [];
  for (let i = 0; i < content.length;) {
    let end = i + 1;
    while (end < content.length && content[end] === content[i]) end++;
    if (option !== '-d' || end - i > 1)
      result.push((option === '-c' ? String(end - i).padStart(7) + ' ' : '') + content[i] + '\n');
    i = end;
  }
  return result.join('');
}

export async function executeCommandPlan(
  plan: Stage[][],
  directories: ScopedDirectory[],
  files: string[],
  session: string,
  signal: AbortSignal,
): Promise<ScopedCommandResult> {
  const root = directories[0]!;
  const cancellation = AbortSignal.any([signal, AbortSignal.timeout(30_000)]);
  const inspect = async (path: string, request: CommandInspection) => {
    const input = /^inputs[\\/](\d+)$/.exec(path);
    if (input) {
      const original = files[Number(input[1]) - 1];
      if (!original) throw new Error('未提供对应的命令输入文件');
      path = original;
    }
    const result = await inspectCommandPath(directories, path, request, cancellation);
    if (result.error) throw new Error(result.error);
    return result;
  };
  const read = async (path: string) =>
    Buffer.from((await inspect(path, { action: 'read' })).data ?? '', 'base64');
  let output = '';
  for (const pipeline of plan) {
    let result: ScopedCommandResult = { exitCode: 0, output: '' };
    for (const stage of pipeline) {
      cancellation.throwIfAborted();
      if (stage.kind === 'vcs') result = await runVcsReads([stage.read], root, cancellation);
      else if (stage.kind === 'http') result = await httpOutput(stage, session, cancellation);
      else if (stage.kind === 'pwd') result = { exitCode: 0, output: root.name + '\n' };
      else if (stage.kind === 'filter') {
        const pattern = stage.insensitive ? stage.pattern.toLowerCase() : stage.pattern;
        const lines = result.output.match(/[^\n]*\n|[^\n]+$/g) ?? [];
        const selected = lines.filter((line) =>
          (stage.insensitive ? line.toLowerCase() : line).includes(pattern),
        );
        result = { exitCode: selected.length ? 0 : 1, output: selected.join('') };
      } else if (stage.kind === 'json') {
        const content = stage.path ? (await read(stage.path)).toString('utf8') : result.output;
        let value: unknown;
        try {
          value = JSON.parse(content);
        } catch {
          return { exitCode: 4, output, error: '输入不是有效的 JSON' };
        }
        for (const field of stage.fields)
          value =
            value && typeof value === 'object' && Object.hasOwn(value, field)
              ? (value as Record<string, unknown>)[field]
              : null;
        result = {
          exitCode: 0,
          output:
            (stage.raw && typeof value === 'string' ? value : JSON.stringify(value ?? null)) + '\n',
        };
      } else if (stage.kind === 'lines') {
        const content = stage.path ? (await read(stage.path)).toString('utf8') : result.output;
        const lines = content.match(/[^\n]*\n|[^\n]+$/g) ?? [];
        result = { exitCode: 0, output: lines.slice(stage.first - 1, stage.last).join('') };
      } else if (stage.kind === 'text') {
        const file = stage.path ? await read(stage.path) : undefined;
        const text =
          file && stage.command === 'wc' && stage.option === '-c'
            ? file.byteLength + '\n'
            : textOutput(stage, file?.toString('utf8') ?? result.output);
        result = { exitCode: 0, output: text };
      } else if (stage.kind === 'hash') {
        const values = [];
        for (const path of stage.paths)
          values.push(
            createHash('sha256')
              .update(await read(path))
              .digest('hex') +
              '  ' +
              path +
              '\n',
          );
        result = { exitCode: 0, output: values.join('') };
      } else {
        const values = [];
        let limited = false;
        let bytes = 0;
        for (const path of stage.paths) {
          const data = await inspect(path, stage.request);
          limited ||= Boolean(data.limited);
          if (stage.request.action === 'read') {
            const file = Buffer.from(data.data ?? '', 'base64');
            bytes += file.byteLength;
            if (bytes > 8 * 1024 * 1024)
              return { exitCode: 1, output, error: '命令输入文件超过 8 MiB' };
            values.push(file.toString('utf8'));
            continue;
          }
          for (const entry of data.entries ?? []) values.push(entry + '\n');
          for (const match of data.matches ?? []) {
            values.push(
              stage.namesOnly
                ? match.path + '\n'
                : match.path +
                    ':' +
                    (stage.numbers ? match.line + ':' : '') +
                    match.text.replace(/\r$/, '') +
                    '\n',
            );
          }
        }
        const text = (stage.namesOnly ? [...new Set(values)] : values).join('');
        result = {
          exitCode: stage.request.action === 'grep' && !values.length ? 1 : 0,
          output: limited ? text + '[搜索结果已截断]\n' : text,
        };
      }
      if (result.error) return { ...result, output: output + result.output };
    }
    output += result.output;
    if (output.length > maxOutput)
      return { exitCode: 0, output: output.slice(0, maxOutput) + '\n[输出已截断]' };
    if (result.exitCode !== 0) return { ...result, output };
  }
  return { exitCode: 0, output };
}
