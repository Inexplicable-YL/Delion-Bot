import { expect, it } from 'vitest';
import { commandNames } from '../../../../src/core/agent/sandbox/command-names';

it('列出管道和命令列表中的每个程序', () => {
  expect(commandNames('grep -n foo inputs/1 | wc -l', 'bash')).toEqual(['grep', 'wc']);
  expect(commandNames('FOO=1 grep x 2>&1 | sort && cat a; exec awk 1 f', 'bash')).toEqual([
    'grep',
    'sort',
    'cat',
    'awk',
  ]);
  expect(commandNames('if grep x f; then rm y; fi', 'bash')).toEqual(['grep', 'rm']);
  expect(commandNames('TYPE a | Find "x" & dir', 'cmd')).toEqual(['type', 'find', 'dir']);
});

it('引号和转义里的分隔符不会藏起程序', () => {
  expect(commandNames("grep 'a;b|c' f", 'bash')).toEqual(['grep']);
  expect(commandNames('grep \\" ; rm \\"', 'bash')).toEqual(['grep', 'rm']);
  expect(commandNames("echo 'a & del b'", 'cmd')).toEqual(['echo', 'del']);
});

it('无法确定实际程序时不提供授权', () => {
  for (const command of [
    'grep $(rm x) f',
    'grep `rm x` f',
    'for f in a; do rm $f; done',
    '(rm x)',
    'xargs rm',
    'sh -c "rm x"',
    "grep 'unclosed",
  ])
    expect(commandNames(command, 'bash')).toBeNull();
  expect(commandNames('if exist a del b', 'cmd')).toBeNull();
});
