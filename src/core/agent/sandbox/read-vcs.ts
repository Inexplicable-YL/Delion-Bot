import { execFile } from 'node:child_process';
import { statSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, dirname, isAbsolute, join, posix } from 'node:path';
import { helperSession, type ScopedCommandResult } from '../../remote/helper';
import { shellQuote } from '../../remote/transport';
import { literalCommands } from './command-names';
import type { ScopedDirectory } from './mode';

const gitFlags = {
  status:
    /^(?:-s|-b|-sb|-bs|--short|--branch|--porcelain(?:=v[12])?|--(?:untracked-files|ignored)(?:=(?:no|normal|all|traditional|matching))?|--show-stash|-u(?:no|normal|all)?)$/,
  diff: /^(?:-[pUw]|-U\d+|--(?:cached|staged|stat|shortstat|numstat|name-only|name-status|patch|no-patch|summary|check|exit-code|quiet|no-renames|no-ext-diff|no-textconv|ignore-space-change|ignore-all-space|word-diff))$/,
  log: /^(?:-[0-9]+|-n|-p|-q|--(?:oneline|stat|name-only|name-status|graph|decorate|all|no-merges|first-parent|reverse|patch|no-patch|no-ext-diff|no-textconv|follow)|--(?:max-count|since|until|author|grep)=[^\r\n]+)$/,
  show: /^(?:-[pq]|--(?:oneline|stat|name-only|name-status|patch|no-patch|summary|no-ext-diff|no-textconv))$/,
  branch:
    /^(?:-[alrv]+|-vv|--(?:all|list|remotes|verbose|show-current|no-color)|--(?:contains|merged|no-merged)(?:=[\w./~-]+)?)$/,
  tag: /^(?:-l|-n\d*|--list|--(?:contains|merged|no-merged)(?:=[\w./~-]+)?)$/,
  'rev-parse':
    /^(?:--(?:verify|short(?:=\d+)?|abbrev-ref|show-toplevel|show-prefix|is-inside-work-tree|git-dir|show-object-format))$/,
  'ls-files':
    /^(?:-[cosmtdu]+|--(?:cached|others|exclude-standard|modified|deleted|stage|unmerged|full-name|deduplicate))$/,
  'ls-tree': /^(?:-[rdtl]+|--(?:name-only|name-status|full-tree|full-name|long))$/,
  'for-each-ref': /^(?:--count=\d+|--sort=-?[\w:]+)$/,
  'show-ref': /^(?:--(?:head|heads|branches|tags|verify|quiet|dereference))$/,
  describe: /^(?:--(?:tags|always|all|long|exact-match|abbrev=\d+))$/,
  blame:
    /^(?:-[lepws]|-L|--(?:line-porcelain|porcelain|show-email|show-name|show-number|date=[\w-]+))$/,
  grep: /^(?:-[inlcvwF]+|-e|--(?:line-number|ignore-case|files-with-matches|count|fixed-strings|cached|word-regexp))$/,
};
const diffCommands = new Set(['diff', 'log', 'show']);
const repository = /^(?:github\.com\/)?[\w-]+\/[\w.-]+$/;
const ghOperations = new Set([
  'pr list',
  'pr view',
  'pr status',
  'pr checks',
  'pr diff',
  'issue list',
  'issue view',
  'issue status',
  'run list',
  'run view',
  'workflow list',
  'workflow view',
  'repo list',
  'repo view',
  'release list',
  'release view',
  'cache list',
  'label list',
  'search repos',
  'search issues',
  'search prs',
  'search commits',
  'search code',
]);
const ghValues = new Set([
  '--json',
  '--jq',
  '-q',
  '--limit',
  '-L',
  '--state',
  '-s',
  '--author',
  '-A',
  '--assignee',
  '-a',
  '--label',
  '-l',
  '--search',
  '-S',
  '--base',
  '-B',
  '--head',
  '-H',
  '--app',
  '--branch',
  '-b',
  '--commit',
  '-c',
  '--event',
  '-e',
  '--status',
  '--workflow',
  '--user',
  '-u',
  '--created',
  '--updated',
  '--closed',
  '--merged',
  '--sort',
  '--order',
  '--owner',
  '--language',
  '--visibility',
  '--job',
  '-j',
  '--attempt',
  '--interval',
]);
const ghSwitches = new Set([
  '--comments',
  '--patch',
  '--name-only',
  '--required',
  '--all',
  '--verbose',
  '-v',
  '--exit-status',
  '--log',
  '--log-failed',
  '--include-pre-releases',
  '--include-drafts',
  '--watch',
]);
const githubURL =
  /^https:\/\/github\.com\/[\w-]+\/[\w.-]+(?:\/(?:issues|pull|actions\/runs)\/\d+)?\/?$/i;
const apiReadPath =
  /^(?:repos\/[\w-]+\/[\w.-]+(?:\/(?:issues|pulls|commits|branches|tags|releases)(?:\/[\w.-]+(?:\/(?:comments|files|reviews|commits|check-runs))?)?|\/actions\/(?:runs|workflows|jobs)(?:\/\d+(?:\/(?:jobs|runs))?)?)?|search\/(?:repositories|issues|commits|code))(?:\?[^#]*)?$/;

function gitRead(args: string[], root: ScopedDirectory) {
  if (args[0] === '--no-pager') args.shift();
  if (args[0] === '-C' && ['.', root.name, root.host].includes(args[1] ?? '')) args.splice(0, 2);
  if (args[0] === '--no-pager') args.shift();
  const [command, ...options] = args;
  if ((command === '--version' || command === 'remote') && !options.length)
    return { args, filters: false };
  if (!command || !Object.hasOwn(gitFlags, command)) return null;
  const flags = gitFlags[command as keyof typeof gitFlags];
  let paths = false;
  let list = false;
  const operands = [];
  for (const arg of options) {
    if (!paths && arg === '--') {
      paths = true;
    } else if (!paths && arg.startsWith('-')) {
      list ||= arg === '--list' || arg === '-l';
      if (
        !flags.test(arg) &&
        !(
          ['log', 'show', 'for-each-ref', 'branch', 'tag'].includes(command) &&
          (/^--(?:format|pretty)=(?:(?:t?format:)?[^%]*%)/.test(arg) ||
            /^--pretty=(?:oneline|short|medium|full|fuller|reference|email|raw)$/.test(arg)) &&
          !/%G/.test(arg)
        )
      )
        return null;
    } else {
      if (arg.split(/[\\/]/).includes('..') || /^(?:[~/\\]|[a-z]:)/i.test(arg)) return null;
      operands.push(arg);
    }
  }
  if ((command === 'branch' || command === 'tag') && operands.length && !list) return null;
  const defaults =
    diffCommands.has(command) || command === 'blame' ? ['--no-ext-diff', '--no-textconv'] : [];
  if (command === 'grep') defaults.push('--no-textconv');
  if (command === 'diff' || command === 'status') defaults.push('--ignore-submodules=all');
  return {
    args: [command, ...defaults, ...options],
    filters: command === 'diff' || command === 'status' || command === 'blame',
  };
}

function ghRead(args: string[]) {
  if (args.length === 1 && args[0] === '--version') return true;
  if (args[0] === 'api') {
    const options = args.slice(1);
    const endpoint = options.findIndex(
      (arg) =>
        apiReadPath.test(arg) &&
        !arg
          .split('?')[0]!
          .split('/')
          .some((part) => part === '..' || part === '.'),
    );
    if (endpoint === -1) return false;
    options.splice(endpoint, 1);
    const rawFields = /^[a-z][\w-]*=/i;
    let explicitGet = false;
    let hasFields = false;
    for (let i = 0; i < options.length; i++) {
      const arg = options[i]!;
      if (arg === '--method=GET' || (['--method', '-X'].includes(arg) && options[++i] === 'GET'))
        explicitGet = true;
      else if (['-f', '--raw-field'].includes(arg) && rawFields.test(options[++i] ?? ''))
        hasFields = true;
      else if (!['--paginate', '--slurp'].includes(arg)) return false;
    }
    return !hasFields || explicitGet;
  }
  if (!ghOperations.has(args.slice(0, 2).join(' '))) return false;
  for (let i = 2; i < args.length; i++) {
    const arg = args[i]!;
    const assignment = arg.indexOf('=');
    const flag = assignment < 0 ? arg : arg.slice(0, assignment);
    if (flag === '-R' || flag === '--repo') {
      if (!repository.test(assignment < 0 ? (args[++i] ?? '') : arg.slice(assignment + 1)))
        return false;
    } else if (ghValues.has(flag)) {
      const value = assignment < 0 ? args[++i] : arg.slice(assignment + 1);
      if (!value || (assignment < 0 && value.startsWith('-'))) return false;
      if ((flag === '--jq' || flag === '-q') && /\b(?:env|ENV)\b/.test(value)) return false;
    } else if (arg.startsWith('-')) {
      if (!ghSwitches.has(arg)) return false;
    } else if (/[:/\\]/.test(arg) && !githubURL.test(arg) && !repository.test(arg)) {
      if (args[0] !== 'search') return false;
    }
  }
  return true;
}

const gitEnvironment = {
  GIT_OPTIONAL_LOCKS: '0',
  GIT_NO_LAZY_FETCH: '1',
  GIT_TERMINAL_PROMPT: '0',
  GIT_CONFIG_COUNT: '0',
  GIT_CONFIG_PARAMETERS: '',
  GIT_TRACE: '0',
  GIT_TRACE2: '0',
  GIT_TRACE2_EVENT: '0',
  GIT_TRACE2_PERF: '0',
};
const gitConfig = [
  '--no-pager',
  '-c',
  'core.fsmonitor=false',
  '-c',
  'core.hooksPath=/dev/null',
  '-c',
  'log.showSignature=false',
  '-c',
  'diff.submodule=short',
  '-c',
  'maintenance.auto=false',
];
const ghEnvironment = {
  GH_HOST: 'github.com',
  GH_REPO: '',
  GH_PROMPT_DISABLED: '1',
  GH_NO_UPDATE_NOTIFIER: '1',
  GH_NO_EXTENSION_UPDATE_NOTIFIER: '1',
  GH_TELEMETRY: 'false',
  GH_PAGER: 'cat',
  GH_FORCE_TTY: '',
};

export function vcsReadCommand(tokens: string[], shell: 'bash' | 'cmd', root: ScopedDirectory) {
  const [name, ...args] = tokens;
  if (name === 'git' || (shell === 'cmd' && /^git(?:\.exe)?$/i.test(name!))) {
    const read = gitRead(args, root);
    return read && { program: 'git' as const, ...read };
  }
  if (name === 'gh' || (shell === 'cmd' && /^gh(?:\.exe)?$/i.test(name!)))
    return ghRead(args)
      ? {
          program: 'gh' as const,
          args: args[0] === 'api' ? ['api', '--hostname=github.com', ...args.slice(1)] : args,
          filters: false,
        }
      : null;
  return null;
}

export function vcsReadCommands(command: string, shell: 'bash' | 'cmd', root: ScopedDirectory) {
  const commands = literalCommands(command, shell);
  if (!commands || commands.length > 8) return null;
  const reads = [];
  for (const tokens of commands) {
    const read = vcsReadCommand(tokens, shell, root);
    if (!read) return null;
    reads.push(read);
  }
  return reads;
}

async function runVcsProgram(
  program: 'git' | 'gh',
  args: string[],
  root: ScopedDirectory,
  signal: AbortSignal,
): Promise<ScopedCommandResult> {
  signal.throwIfAborted();
  const ghLogs =
    program === 'gh' &&
    args[0] === 'run' &&
    args[1] === 'view' &&
    args.some((arg) => arg === '--log' || arg === '--log-failed');
  const settings = {
    ...gitEnvironment,
    ...(program === 'gh' && ghEnvironment),
    GIT_CEILING_DIRECTORIES: (root.remote ? posix.dirname : dirname)(root.host),
  };
  const limit = 128 * 1024;
  if (root.remote) {
    let output = Buffer.alloc(0);
    let truncated = false;
    const invocation = [program, ...args].map(shellQuote).join(' ');
    const command = ghLogs
      ? `XDG_CACHE_HOME=$(/usr/bin/mktemp -d /tmp/delion-gh.XXXXXXXXXX) && export XDG_CACHE_HOME && trap '/bin/rm -rf -- "$XDG_CACHE_HOME"' EXIT && command -p ${invocation}`
      : `command -p ${invocation}`;
    const result = await helperSession(root.remote).exec(command, {
      cwd: root.host,
      signal,
      timeoutMs: 20_000,
      env: { ...settings, BASH_ENV: '' },
      onData(chunk) {
        truncated ||= output.length + chunk.length > limit;
        if (output.length < limit)
          output = Buffer.concat([output, chunk.subarray(0, limit - output.length)]);
      },
    });
    return {
      exitCode: truncated ? null : result.code,
      output: output.toString('utf8'),
      ...(truncated ? { error: '命令输出超过大小限制' } : {}),
    };
  }
  const windows = process.platform === 'win32';
  const executable = process.env.PATH?.split(delimiter)
    .map((entry) => entry.replace(/^"(.*)"$/, '$1'))
    .filter((entry) => isAbsolute(entry))
    .map((entry) => join(entry, windows ? `${program}.exe` : program))
    .find((path) => statSync(path, { throwIfNoEntry: false })?.isFile());
  if (!executable) return { exitCode: null, output: '', error: `找不到 ${program}` };
  const cache = ghLogs ? await mkdtemp(join(tmpdir(), 'delion-gh-')) : undefined;
  try {
    return await new Promise((resolve) => {
      const child = execFile(
        executable,
        args,
        {
          cwd: root.host,
          signal,
          timeout: 20_000,
          maxBuffer: limit,
          windowsHide: true,
          env: {
            ...process.env,
            ...settings,
            ...(cache && { XDG_CACHE_HOME: cache }),
            NoDefaultCurrentDirectoryInExePath: '1',
          },
        },
        (error, stdout, stderr) =>
          resolve({
            exitCode: error ? (typeof error.code === 'number' ? error.code : null) : 0,
            output: stdout + stderr,
            ...(error && typeof error.code !== 'number' && { error: `${program} 无法完成读取` }),
          }),
      );
      child.stdin?.on('error', () => {});
      child.stdin?.end();
    });
  } finally {
    if (cache) await rm(cache, { recursive: true, force: true });
  }
}

async function runVcsRead(
  read: NonNullable<ReturnType<typeof vcsReadCommand>>,
  root: ScopedDirectory,
  signal: AbortSignal,
) {
  const { program, args, filters } = read;
  const config = program === 'git' ? [...gitConfig] : [];
  if (filters) {
    const result = await runVcsProgram(
      'git',
      ['--no-pager', 'config', '--null', '--name-only', '--get-regexp', '^filter\\.'],
      root,
      signal,
    );
    const keys = result.output.split('\0').filter(Boolean);
    if (
      (result.exitCode !== 0 && !(result.exitCode === 1 && !keys.length)) ||
      (keys.length && !result.output.endsWith('\0')) ||
      keys.some((key) => !/^filter\.[\w.-]+\.(?:[\w-]+)$/.test(key))
    )
      return { exitCode: null, output: '', error: '无法验证 Git 过滤器配置' };
    for (const filter of new Set(keys.map((key) => key.slice(0, key.lastIndexOf('.'))))) {
      for (const key of ['clean', 'smudge', 'process', 'required'])
        config.push('-c', `${filter}.${key}=${key === 'required' ? 'false' : ''}`);
    }
  }
  return runVcsProgram(program, [...config, ...args], root, signal);
}

export async function runVcsReads(
  reads: NonNullable<ReturnType<typeof vcsReadCommands>>,
  root: ScopedDirectory,
  signal: AbortSignal,
): Promise<ScopedCommandResult> {
  const cancellation = AbortSignal.any([signal, AbortSignal.timeout(20_000)]);
  let output = '';
  for (const read of reads) {
    const result = await runVcsRead(read, root, cancellation);
    output += result.output;
    if (output.length > 128 * 1024)
      return { exitCode: null, output: output.slice(0, 128 * 1024), error: '命令输出超过大小限制' };
    if (result.exitCode !== 0) return { ...result, output };
  }
  return { exitCode: 0, output };
}
