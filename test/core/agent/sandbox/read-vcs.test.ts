import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { runVcsReads, vcsReadCommands } from '../../../../src/core/agent/sandbox/read-vcs';

it('按操作和参数判断 Git、GitHub CLI 是否只读', () => {
  const root = { name: '/project' as const, host: '/repo' };
  for (const command of [
    'git -C /project status --short',
    'git diff --cached --stat',
    'git log --oneline -10',
    'git status --short && git diff --stat',
    'git branch --show-current',
    'git grep -n TODO -- src',
    'git blame --line-porcelain a.txt',
    'git tag --list "v*"',
    'gh issue view 123 --comments',
    'gh pr list -R owner/repo --state open --json number,title',
    'gh pr view 123 --json title --jq .title',
    'gh run view 123 --exit-status',
    'gh run view 123 --log-failed',
    'gh search prs "repo:owner/repo is:open"',
    'gh api "repos/owner/repo/pulls?per_page=10" -X GET --paginate',
    'gh api repos/owner/repo/pulls -X GET -f state=open',
  ]) {
    expect(vcsReadCommands(command, 'bash', root), command).not.toBeNull();
  }
  expect(vcsReadCommands('GH.EXE pr checks 123', 'cmd', root)).not.toBeNull();
  expect(vcsReadCommands('git log --format="%h %s"', 'cmd', root)).not.toBeNull();
  for (const command of [
    'git -C .. status',
    'git -c core.fsmonitor=command status',
    'git diff --output=report.txt',
    'git diff --ext-diff',
    'git log --format=%G?',
    'git log --pretty=custom',
    'git branch new-branch',
    'git branch -- new-branch --list',
    'git tag new-tag',
    'git push',
    'git status & git diff',
    'git status && git push',
    'gh pr view 123 --web',
    'gh pr view 123 -w',
    'gh pr view 123 --json title --jq env',
    "gh pr view 123 --json title --jq '$ENV'",
    'gh pr create --title example',
    'gh pr merge 123',
    'gh run download 123',
    'gh repo view -R private.example/owner/repo',
    'gh api repos/owner/repo/issues -f title=example',
    'gh api repos/owner/repo/issues --method POST',
    'gh api repos/owner/repo/issues --input request.json',
    'gh api repos/owner/repo/issues -F body=@note.txt -X GET',
    'gh api graphql -f query=mutation',
    'gh api https://private.example/path',
  ]) {
    expect(vcsReadCommands(command, 'bash', root), command).toBeNull();
  }
});

it('Git 状态和差异读取不会刷新索引或调用过滤器', async () => {
  const host = mkdtempSync(join(tmpdir(), 'delion-read-git-'));
  const root = { name: '/project' as const, host };
  const git = (...args: string[]) =>
    execFileSync('git', args, { cwd: host, stdio: ['ignore', 'ignore', 'pipe'] });
  try {
    git('init', '-q');
    git('config', 'core.autocrlf', 'false');
    writeFileSync(join(host, 'a.txt'), 'before\n');
    git('add', '--', 'a.txt');
    git('-c', 'user.email=dev@example.test', '-c', 'user.name=Dev', 'commit', '-qm', 'first');
    writeFileSync(join(host, '.gitattributes'), '*.txt filter=delion-test\n');
    git('config', 'filter.delion-test.clean', 'printf ran > filter-ran; cat');
    writeFileSync(join(host, 'a.txt'), 'after\n');
    const index = readFileSync(join(host, '.git', 'index'));
    const reads = vcsReadCommands('git status --short && git diff -- a.txt', 'bash', root)!;
    const result = await runVcsReads(reads, root, AbortSignal.timeout(8000));
    expect(result.exitCode).toBe(0);
    expect(result.output).toContain(' M a.txt');
    expect(result.output).toContain('+after');
    expect(readFileSync(join(host, '.git', 'index'))).toEqual(index);
    expect(existsSync(join(host, 'filter-ran'))).toBe(false);
  } finally {
    rmSync(host, { recursive: true, force: true });
  }
});
