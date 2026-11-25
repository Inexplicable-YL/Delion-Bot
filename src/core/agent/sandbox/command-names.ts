const separators = new Set(['|', '&', ';', '\n']);
const substitution = /`|\$\(|[<>]\(/;
const launchers = new Set([
  'sh',
  'bash',
  'zsh',
  'dash',
  'env',
  'xargs',
  'eval',
  'source',
  '.',
  'command',
  'builtin',
  'sudo',
  'nohup',
  'nice',
  'timeout',
  'powershell',
  'pwsh',
]);
const deletions = new Set(['rm', 'rmdir', 'unlink', 'shred', 'del', 'erase', 'rd']);
const subcommandPrograms = new Set([
  'git',
  'npm',
  'npx',
  'pnpm',
  'yarn',
  'bun',
  'cargo',
  'go',
  'docker',
  'gh',
  'pip',
  'pip3',
  'uv',
  'dotnet',
  'kubectl',
]);
const shells = {
  bash: {
    quotes: new Set(['"', "'"]),
    escape: '\\',
    expansion: '$',
    unquotedSpecial: /[<>(){}~$]/,
    readOnly: new Set([
      'cat',
      'head',
      'tail',
      'wc',
      'ls',
      'pwd',
      'echo',
      'printf',
      'grep',
      'egrep',
      'fgrep',
      'find',
      'stat',
      'du',
      'diff',
      'cmp',
      'cut',
      'tr',
      'nl',
      'tac',
      'sort',
      'uniq',
      'basename',
      'dirname',
      'realpath',
      'which',
      'uname',
      'whoami',
    ]),
    discardedOutput: /^\d?>(&\d|\/dev\/null)$/,
    absolutePath: /^[/~]/,
    skipped: new Set([
      'exec',
      'time',
      '!',
      'if',
      'then',
      'else',
      'elif',
      'while',
      'until',
      'do',
      'fi',
      'done',
    ]),
    compound: /^(for|case|select|function|coproc|[({]|\[\[?)$|\(\)$/,
  },
  cmd: {
    quotes: new Set(['"']),
    escape: '^',
    expansion: '%',
    unquotedSpecial: /[<>()%]/,
    readOnly: new Set(['dir', 'type', 'find', 'findstr', 'where', 'tree', 'echo']),
    discardedOutput: /^\d?>(&\d|nul)$/i,
    absolutePath: /^\\|:|^\/(?![a-z?]$)/i,
    skipped: new Set<string>(),
    compound: /^(if|for|call|start|cmd)$|^[({@]/i,
  },
};
const findActions = new Set([
  '-exec',
  '-execdir',
  '-ok',
  '-okdir',
  '-delete',
  '-fprint',
  '-fprint0',
  '-fprintf',
  '-fls',
]);

type Shell = keyof typeof shells;
interface Word {
  text: string;
  plain: boolean;
  special: boolean;
}

function commandWords(command: string, shell: Shell): Word[][] | null {
  if (substitution.test(command)) return null;
  const { quotes, escape, expansion, unquotedSpecial } = shells[shell];
  const segments: Word[][] = [[]];
  let word = '';
  let literal = false;
  let special = false;
  let quote: string | null = null;
  let escaped = false;
  let previous = '';

  const finishWord = () => {
    if (word || literal) segments.at(-1)!.push({ text: word, plain: !literal, special });
    word = '';
    literal = false;
    special = false;
  };

  for (const char of command) {
    const before = previous;
    previous = char;
    if (escaped) {
      escaped = false;
      literal = true;
      if (char !== '\n') word += char;
    } else if (quote) {
      if (char === quote) quote = null;
      else {
        special ||= quote === '"' && char === expansion;
        word += char;
      }
    } else if (char === escape) {
      escaped = true;
    } else if (quotes.has(char)) {
      quote = char;
      literal = true;
    } else if (separators.has(char) && !(char === '&' && (before === '>' || before === '<'))) {
      finishWord();
      segments.push([]);
    } else if (/\s/.test(char)) {
      finishWord();
    } else {
      special ||=
        unquotedSpecial.test(char) ||
        (shell === 'bash' && /[*?[]/.test(char) && /(^|\/)\.$/.test(word));
      word += char;
    }
  }
  if (quote || escaped) return null;
  finishWord();
  return segments;
}

export function commandNames(command: string, shell: Shell): string[] | null {
  const segments = commandWords(command, shell);
  if (!segments) return null;
  const { skipped, compound } = shells[shell];
  const name = ({ text }: Word) => (shell === 'cmd' ? text.toLowerCase() : text);
  const names = new Set<string>();
  for (const words of segments) {
    const start = words.findIndex(
      (word) =>
        !word.plain || !(/^[A-Za-z_][A-Za-z0-9_]*=/.test(name(word)) || skipped.has(name(word))),
    );
    if (start === -1) continue;
    const program = words[start]!;
    const current = name(program);
    if (
      !current ||
      (program.plain && compound.test(current)) ||
      /[$%<>(){}!]/.test(current) ||
      launchers.has(current) ||
      deletions.has(current)
    )
      return null;
    if (!subcommandPrograms.has(current)) {
      names.add(current);
      continue;
    }
    const subcommand = words[start + 1];
    if (!subcommand?.plain || !/^[a-z][\w:-]*$/i.test(subcommand.text)) return null;
    names.add(`${current} ${name(subcommand)}`);
  }
  return names.size ? [...names] : null;
}

export function readOnlyCommand(
  command: string,
  shell: Shell,
  virtualRoots: readonly string[],
): boolean {
  const segments = commandWords(command, shell);
  const { readOnly, discardedOutput, absolutePath } = shells[shell];
  return Boolean(
    segments?.every((words) => {
      const [program, ...args] = words;
      if (!program) return true;
      const name = shell === 'cmd' ? program.text.toLowerCase() : program.text;
      if (program.special || !readOnly.has(name)) return false;
      const values = args.filter(({ text, plain }) => !(plain && discardedOutput.test(text)));
      const operands = values.filter(({ text }) => !text.startsWith('-'));
      return (
        values.every(
          ({ text, special }) =>
            !special &&
            !text.includes('..') &&
            !(text.startsWith('-') && /[\\/]/.test(text)) &&
            (!absolutePath.test(text) ||
              virtualRoots.some(
                (root) =>
                  text === root || text.startsWith(`${root}/`) || text.startsWith(`${root}\\`),
              )),
        ) &&
        !(name === 'find' && values.some(({ text }) => findActions.has(text))) &&
        !(name === 'sort' && values.some(({ text }) => /^-[^-]*o|^--c?o/.test(text))) &&
        !(name === 'uniq' && operands.length > 1)
      );
    }),
  );
}
