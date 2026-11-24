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
const shells = {
  bash: {
    quotes: new Set(['"', "'"]),
    escape: '\\',
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
    skipped: new Set<string>(),
    compound: /^(if|for|call|start|cmd)$|^[({@]/i,
  },
};

export function commandNames(command: string, shell: keyof typeof shells): string[] | null {
  if (substitution.test(command)) return null;
  const { quotes, escape, skipped, compound } = shells[shell];
  const names = new Set<string>();
  let atStart = true;
  let word = '';
  let literal = false;
  let quote: string | null = null;
  let escaped = false;
  let previous = '';

  const finishWord = () => {
    if (!word && !literal) return true;
    const current = shell === 'cmd' ? word.toLowerCase() : word;
    const plain = !literal;
    word = '';
    literal = false;
    if (!atStart) return true;
    if (plain && (/^[A-Za-z_][A-Za-z0-9_]*=/.test(current) || skipped.has(current))) return true;
    if (
      !current ||
      (plain && compound.test(current)) ||
      /[$%<>(){}!]/.test(current) ||
      launchers.has(current)
    )
      return false;
    names.add(current);
    atStart = false;
    return true;
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
      else word += char;
    } else if (char === escape) {
      escaped = true;
    } else if (quotes.has(char)) {
      quote = char;
      literal = true;
    } else if (separators.has(char) && !(char === '&' && (before === '>' || before === '<'))) {
      if (!finishWord()) return null;
      atStart = true;
    } else if (/\s/.test(char)) {
      if (!finishWord()) return null;
    } else {
      word += char;
    }
  }
  if (quote || escaped || !finishWord()) return null;
  return names.size ? [...names] : null;
}
