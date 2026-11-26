import { createHash } from 'node:crypto';
import type { ScopedCommandResult } from '../../remote/helper';
import { literalPipelines } from './command-names';
import { parseHttpCommand, runHttpCommand, type HttpCommand } from './http-command';
import type { ScopedDirectory } from './mode';
import {
  commandCopyTarget,
  inspectCommandPath,
  writeCommandFile,
  type CommandInspection,
} from './scoped-files';
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
  | { kind: 'http'; request: HttpCommand }
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
  let expression: string | undefined;
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
    } else if ((arg === '-e' || arg === '--regexp') && expression === undefined) {
      expression = args[++index];
      if (!expression) return null;
    } else if (arg === '--ignore-case') insensitive = true;
    else if (arg === '--fixed-strings') fixed = true;
    else if (arg === '--line-number') numbers = true;
    else if (arg === '--files-with-matches') namesOnly = true;
    else if (/^-[rREFinHl]+$/.test(arg)) {
      insensitive ||= arg.includes('i');
      fixed ||= arg.includes('F');
      numbers ||= arg.includes('n');
      namesOnly ||= arg.includes('l');
    } else return null;
  }
  if (glob !== undefined && (!glob || /[/\\!{}]/.test(glob) || glob.length > 512)) return null;
  if (files && expression) return null;
  const paths = files || expression ? operands : operands.slice(1);
  let pattern = files ? (glob ?? '*') : (expression ?? operands[0]);
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
    program = program?.replace(/^\/(?:usr\/(?:local\/)?)?bin\//, '');
  }
  if (program === 'pwd' && !piped && !args.length) return { kind: 'pwd' };
  if (program === 'jq') {
    let raw = false;
    while (/^(?:-[rc]+|--(?:compact-output|raw-output))$/.test(args[0] ?? '')) {
      const flag = args.shift()!;
      raw ||= flag === '--raw-output' || (!flag.startsWith('--') && flag.includes('r'));
    }
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
  if (program && !piped && !root.remote) {
    const request = parseHttpCommand(program, args, shell === 'cmd');
    if (request) return { kind: 'http', request };
  }
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
    } else {
      const lines = /^(?:-n?|--lines=)(\d{1,6})$/.exec(args[0] ?? '');
      if (lines) {
        count = Number(lines[1]);
        args.shift();
      }
    }
  } else {
    const accepted = { wc: /^-[lwmc]+$/, sort: /^-[nru]+$/, uniq: /^-[cd]$/ };
    if (accepted[program as keyof typeof accepted].test(args[0] ?? '')) option = args.shift();
  }
  if (args[0] === '--') args = args.slice(1);
  if (piped ? args.length > 0 : args.length !== 1 || args[0]!.startsWith('-')) return null;
  return { kind: 'text', command: program, path: args[0], count, option };
}

export function commandPlan(
  command: string,
  shell: 'bash' | 'cmd',
  directories: ScopedDirectory[],
  hasInputs: boolean,
) {
  const pipelines = literalPipelines(command, shell);
  if (!pipelines) return null;
  const root = directories[0]!;
  const stages = pipelines.map((pipeline) =>
    pipeline.map((tokens, index) => parseStage(tokens, shell, root, index > 0)),
  );
  if (!stages.every((pipeline) => pipeline.every((stage) => stage !== null))) return null;
  const steps = stages as Stage[][];
  if (steps.flat().some((stage) => stage.kind === 'http' && stage.request.write)) {
    return steps.length === 1 && steps[0]!.length === 1 && !hasInputs
      ? { steps, readOnly: false, requiresApproval: true }
      : null;
  }
  const targets = new Map<Stage, NonNullable<ReturnType<typeof commandCopyTarget>>>();
  for (const stage of steps.flat()) {
    if (stage.kind !== 'http' || !stage.request.path) continue;
    if (hasInputs) return null;
    const target = commandCopyTarget(directories, stage.request.path);
    if (!target || target.key === '.') return null;
    targets.set(stage, target);
  }
  return { steps, readOnly: targets.size === 0, targets };
}

export function commandPlanPermissions(plan: NonNullable<ReturnType<typeof commandPlan>>) {
  return plan.steps.flat().map((stage) => {
    if (stage.kind === 'http') {
      const origin = stage.request.url.origin;
      const { write, method, headers, url } = stage.request;
      if (write) {
        const digest = createHash('sha256')
          .update(JSON.stringify([url.href, [...headers], write.body]))
          .digest('hex');
        return {
          key: ['http-write', method, digest],
          label: `重复同一 ${method} 请求到 ${origin}`,
        };
      }
      const target = plan.targets?.get(stage);
      return target
        ? {
            key: ['http-download', origin, target.root.name, target.root.host],
            label: `从 ${origin} 下载到 ${target.root.name}`,
          }
        : { key: ['http-read', origin], label: `读取 ${origin} 的 HTTP 响应` };
    }
    if (stage.kind === 'vcs') {
      const { program, args } = stage.read;
      const operation = [program, ...args.slice(0, program === 'gh' && args[0] !== 'api' ? 2 : 1)];
      return { key: ['vcs-read', ...operation], label: operation.join(' ') + ' 只读' };
    }
    if (stage.kind === 'inspect') {
      const action = stage.request.action;
      return {
        key: ['inspect', action],
        label: { read: '读取文件', ls: '列出文件', find: '查找文件', grep: '搜索文件内容' }[action],
      };
    }
    if (stage.kind === 'pwd') return { key: ['pwd'], label: '查看工作目录' };
    if (stage.kind === 'hash') return { key: ['hash'], label: '计算文件校验值' };
    return { key: ['filter'], label: '筛选和格式化命令输出' };
  });
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
    const values = { l: lineCount, w: words, m: Array.from(data).length, c: size };
    return (
      Object.entries(values)
        .filter(([flag]) => (option || 'lwc').includes(flag))
        .map(([, value]) => value)
        .join(' ') + '\n'
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
  plan: NonNullable<ReturnType<typeof commandPlan>>,
  directories: ScopedDirectory[],
  files: string[],
  session: string,
  signal: AbortSignal,
  onOutput: (text: string) => void,
): Promise<Omit<ScopedCommandResult, 'output'>> {
  const root = directories[0]!;
  const cancellation = AbortSignal.any([signal, AbortSignal.timeout(30_000)]);
  const inspect = async (path: string, request: CommandInspection) => {
    const input = /^inputs[\\/](\d+)$/.exec(path);
    if (input) {
      const original = files[Number(input[1]) - 1];
      if (!original) throw new Error('The matching command input file was not provided.');
      path = original;
    }
    const result = await inspectCommandPath(directories, path, request, cancellation);
    if (result.error) throw new Error(result.error);
    return result;
  };
  const read = async (path: string) =>
    Buffer.from((await inspect(path, { action: 'read' })).data ?? '', 'base64');
  let searchLimited = false;
  let skippedFiles = 0;
  const diagnostics = () => ({
    ...(searchLimited && { searchLimited }),
    ...(skippedFiles && { skippedFiles }),
  });
  for (const pipeline of plan.steps) {
    let result: ScopedCommandResult = { exitCode: 0, output: '' };
    for (const stage of pipeline) {
      cancellation.throwIfAborted();
      if (stage.kind === 'vcs') result = await runVcsReads([stage.read], root, cancellation);
      else if (stage.kind === 'http') {
        const target = plan.targets?.get(stage);
        result = await runHttpCommand(
          stage.request,
          session,
          cancellation,
          target &&
            (async (bytes, signal) => {
              const saved = await writeCommandFile(target, bytes, signal);
              if (saved.error) throw new Error(saved.error);
            }),
        );
      } else if (stage.kind === 'pwd') result = { exitCode: 0, output: root.name + '\n' };
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
          return { exitCode: 4, error: 'The input is not valid JSON.', ...diagnostics() };
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
        let bytes = 0;
        for (const path of stage.paths) {
          const data = await inspect(path, stage.request);
          searchLimited ||= Boolean(data.limited);
          skippedFiles += data.skippedFiles ?? 0;
          if (stage.request.action === 'read') {
            const file = Buffer.from(data.data ?? '', 'base64');
            bytes += file.byteLength;
            if (bytes > 8 * 1024 * 1024)
              return {
                exitCode: 1,
                error: 'The command input files exceed 8 MiB.',
                ...diagnostics(),
              };
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
          output: text,
        };
      }
      if (result.error) {
        onOutput(result.output);
        return {
          exitCode: result.exitCode,
          error: result.error,
          ...(result.output_truncated && { output_truncated: true }),
          ...diagnostics(),
        };
      }
    }
    onOutput(result.output);
    if (result.exitCode !== 0) return { exitCode: result.exitCode, ...diagnostics() };
  }
  return { exitCode: 0, ...diagnostics() };
}
