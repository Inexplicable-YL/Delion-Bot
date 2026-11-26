import { expect, it } from 'vitest';
import {
  commandPlan,
  commandPlanPermissions,
} from '../../../../src/core/agent/sandbox/command-plan';
import { commandNames } from '../../../../src/core/agent/sandbox/command-names';
import { parseHttpCommand } from '../../../../src/core/agent/sandbox/http-command';

const directories = [
  { name: '/privacy' as const, host: '/session' },
  { name: '/share' as const, host: '/shared' },
];

it('识别常见 HTTP 查询、请求头、元数据和输出选项', () => {
  const curl = parseHttpCommand(
    'curl',
    [
      '-fsSLG',
      '--url=https://example.test/feed?type=docs',
      '--data-urlencode',
      'q=two words',
      '-HAccept: application/json',
      '-w%{http_code}',
    ],
    false,
  );
  expect(curl).toMatchObject({ method: 'GET', follow: true, fail: 'fail', report: '%{http_code}' });
  expect(curl?.url.search).toBe('?type=docs&q=two+words');
  expect(
    parseHttpCommand('curl', ['--url-query=page=2', 'https://example.test/'], false)?.url.search,
  ).toBe('?page=2');
  expect(curl?.headers.get('accept')).toBe('application/json');
  expect(
    parseHttpCommand('wget', ['-qS', '--spider', 'https://example.test/'], false),
  ).toMatchObject({ method: 'HEAD', showHeaders: true, showBody: false });
  expect(
    parseHttpCommand('http', ['--follow', 'GET', 'https://example.test/', 'page==2'], false),
  ).toMatchObject({ method: 'GET', follow: true, url: new URL('https://example.test/?page=2') });
  expect(
    parseHttpCommand('iwr', ['-Uri', 'https://example.test/', '-Method', 'Head'], true),
  ).toMatchObject({ method: 'HEAD', showHeaders: true });
});

it('下载只能自动写入会话范围，可重复审批的网络写入绑定实际请求', () => {
  const plan = (command: string) => commandPlan(command, 'bash', directories, false);
  const keys = (command: string) => commandPlanPermissions(plan(command)!).map(({ key }) => key);
  const read = 'curl -sS https://example.test/api';
  const save = 'wget -qO /share/report.pdf https://example.test/doc';
  const write = `curl -sS --json '{"note":"a"}' https://example.test/api`;
  expect(plan(read)).toMatchObject({ readOnly: true });
  expect(plan(save + ' && sha256sum /share/report.pdf')).toMatchObject({ readOnly: false });
  expect(plan(write)).toMatchObject({ readOnly: false, requiresApproval: true });
  expect(keys(write)).toEqual(keys(write.replace('-sS', '-fsS')));
  expect(keys(write)).not.toEqual(keys(write.replace('"a"', '"b"')));
  expect(keys(write)).not.toEqual(keys(write.replace('/api', '/other')));
  expect(keys(write)).not.toEqual(keys(write.replace('-sS', '-sSX PATCH')));
  expect(keys(read)).not.toEqual(keys(write));
  expect(keys(read)).not.toEqual(keys(save));
  for (const command of [
    'curl -fsSL -o /outside/report.pdf https://example.test/doc',
    'curl -o /share/../report.pdf https://example.test/doc',
    'curl -T /privacy/local.txt https://example.test/api',
    'curl -d @/privacy/local.txt https://example.test/api',
    'curl -G --data-urlencode id@/privacy/local.txt https://example.test/api',
    'curl -K /privacy/client.conf https://example.test/api',
    'curl -X DELETE https://example.test/api',
    'curl -H "X-HTTP-Method-Override: DELETE" https://example.test/api',
    'curl -H "Authorization: Bearer token" https://example.test/api',
    'curl -o- file:///privacy/local.txt',
    'curl https://example.test/api > /share/response.txt',
    write + ' | head -n 1',
  ]) {
    expect(plan(command), command).toBeNull();
    expect(commandNames(command, 'bash'), command).toBeNull();
  }
});
