import { expect, it } from 'vitest';
import { commandNames, readOnlyCommand } from '../../../../src/core/agent/sandbox/command-names';

it('列出管道和命令列表中的每个程序', () => {
  expect(commandNames('grep -n foo inputs/1 | wc -l', 'bash')).toEqual(['grep', 'wc']);
  expect(commandNames('FOO=1 grep x 2>&1 | sort && cat a; exec awk 1 f', 'bash')).toEqual([
    'grep',
    'sort',
    'cat',
    'awk',
  ]);
  expect(commandNames('if grep x f; then touch y; fi', 'bash')).toEqual(['grep', 'touch']);
  expect(commandNames('TYPE a | Find "x" & dir', 'cmd')).toEqual(['type', 'find', 'dir']);
});

it('多子命令工具按子命令区分授权', () => {
  expect(commandNames('git status && pnpm run test -- --watch', 'bash')).toEqual([
    'git status',
    'pnpm run',
  ]);
  expect(commandNames('git -C .. push', 'bash')).toBeNull();
  expect(commandNames('git', 'bash')).toBeNull();
  expect(commandNames('GH.EXE pr comment 12 --body test', 'cmd')).toEqual(['gh pr comment']);
  expect(commandNames('gh pr merge 12', 'bash')).toEqual(['gh pr merge']);
  expect(commandNames('gh api repos/a/b/issues -X POST', 'bash')).toBeNull();
  expect(commandNames('gh pr view 12 --json title -qenv', 'bash')).toBeNull();
  expect(commandNames('git branch -D example', 'bash')).toBeNull();
  expect(commandNames('git push --delete origin example', 'bash')).toBeNull();
});

it('引号和转义里的分隔符不会藏起程序', () => {
  expect(commandNames("grep 'a;b|c' f", 'bash')).toEqual(['grep']);
  expect(commandNames('grep \\" ; touch \\"', 'bash')).toEqual(['grep', 'touch']);
  expect(commandNames("echo 'a & copy b'", 'cmd')).toEqual(['echo', 'copy']);
});

it('无法确定实际程序或包含删除时不提供授权', () => {
  for (const command of [
    'grep $(rm x) f',
    'grep `rm x` f',
    'for f in a; do rm $f; done',
    '(rm x)',
    'xargs rm',
    'sh -c "rm x"',
    "grep 'unclosed",
    'ls && rm -rf build',
  ])
    expect(commandNames(command, 'bash')).toBeNull();
  expect(commandNames('if exist a del b', 'cmd')).toBeNull();
  expect(commandNames('dir & del b', 'cmd')).toBeNull();
});

it('只读命令仅在不写入、不执行、不越出工作目录时免审批', () => {
  for (const command of [
    'ls -la',
    'grep -rn "TODO" src | head -n 20',
    'find . -name "*.ts" -type f 2>/dev/null | sort | uniq -c',
    'cat package.json && wc -l src/*.ts',
    "grep -c '$HOME' notes.md 2>&1",
  ])
    expect(readOnlyCommand(command, 'bash', [])).toBe(true);
  expect(readOnlyCommand('cat /share/a.txt | head', 'bash', ['/privacy', '/share'])).toBe(true);
  expect(readOnlyCommand('dir /b src & findstr /s "x" *.ts 2>nul', 'cmd', [])).toBe(true);
  for (const command of [
    'cat ../secret',
    'cat ~/.ssh/id_rsa',
    'cat /etc/passwd',
    'cat .*/id_rsa',
    'grep -f/etc/passwd x',
    'cat "$HOME/.netrc"',
    'ls > out.txt',
    'cat a 2> err.txt',
    'find . -name x -delete',
    'find . -exec cat {} +',
    'find *',
    'sort -o out.txt a',
    'sort --compress-program=sh a',
    'sort -T scratch a',
    'wc --files0-from=list.txt',
    'printf -v PATH . && grep example file.txt',
    'uniq a out.txt',
    'uniq -- a -out.txt',
    'cd .. && ls',
    'ls && touch x',
    'git status',
    'cat /share/a.txt',
  ])
    expect(readOnlyCommand(command, 'bash', [])).toBe(false);
  for (const command of ['type C:\\secret.txt', 'type \\secret.txt', 'type %USERPROFILE%\\x'])
    expect(readOnlyCommand(command, 'cmd', [])).toBe(false);
});
