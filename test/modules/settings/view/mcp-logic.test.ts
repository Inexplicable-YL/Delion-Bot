import { describe, expect, it } from 'vitest';
import {
  mcpUpdatePatch,
  parseEnvText,
  parseMcpForm,
} from '../../../../src/modules/settings/view/agent/mcp-logic';

describe('parseEnvText', () => {
  it('env 每行 KEY=VALUE：允许空值与空行，以第一个 = 切开，重复键取后者', () => {
    expect(parseEnvText('A=1\nB=\n\n C = 2 \nCONN=a=b\nA=3')).toEqual({
      pairs: { A: '3', B: '', C: '2', CONN: 'a=b' },
      error: null,
    });
  });

  it('缺分隔符或空键时报错并指明行号', () => {
    expect(parseEnvText('A=1\nBAD').error).toBe('环境变量第 2 行应为 KEY=VALUE 格式');
    expect(parseEnvText(' =1').error).toBe('环境变量第 1 行应为 KEY=VALUE 格式');
  });
});

describe('parseMcpForm', () => {
  const blank = { name: 's', command: '', argsText: '', envText: '', url: '', headers: [] };
  const stdio = { ...blank, transport: 'stdio' as const };
  const http = { ...blank, transport: 'http' as const };

  it('stdio：去空白后的各字段', () => {
    expect(
      parseMcpForm(
        { ...stdio, name: ' weather ', command: ' npx ', argsText: '-y\nserver', envText: 'K=1' },
        { isEdit: false },
      ),
    ).toEqual({
      ok: true,
      value: {
        transport: 'stdio',
        name: 'weather',
        command: 'npx',
        args: ['-y', 'server'],
        env: { K: '1' },
      },
    });
  });

  it('http：地址与请求头，只接受 http/https', () => {
    expect(
      parseMcpForm(
        {
          ...http,
          url: ' https://a.com/mcp ',
          headers: [
            { name: ' Authorization ', value: ' Bearer a:b ' },
            { name: 'X-Flag', value: '' },
            { name: '', value: '' },
          ],
        },
        { isEdit: false },
      ),
    ).toEqual({
      ok: true,
      value: {
        transport: 'http',
        name: 's',
        url: 'https://a.com/mcp',
        headers: { Authorization: 'Bearer a:b', 'X-Flag': '' },
      },
    });
    expect(parseMcpForm({ ...http, url: 'ftp://a' }, { isEdit: false })).toEqual({
      ok: false,
      error: '地址需以 http:// 或 https:// 开头',
    });
  });

  it('HTTP 标头有值时必须填写有效名称', () => {
    expect(
      parseMcpForm(
        { ...http, url: 'https://a.com/mcp', headers: [{ name: '', value: 'Bearer t' }] },
        { isEdit: false },
      ).ok,
    ).toBe(false);
  });

  it('名称必填且不含空白', () => {
    expect(parseMcpForm({ ...stdio, name: '  ', command: 'npx' }, { isEdit: false })).toEqual({
      ok: false,
      error: '名称不能为空',
    });
    expect(
      parseMcpForm({ ...stdio, name: 'my\tserver', command: 'npx' }, { isEdit: false }),
    ).toEqual({ ok: false, error: '名称不能包含空格' });
  });

  it('command 与地址：新建必填，编辑可留空（保持原值）', () => {
    expect(parseMcpForm(stdio, { isEdit: false })).toEqual({
      ok: false,
      error: '命令不能为空',
    });
    expect(parseMcpForm(http, { isEdit: false })).toEqual({ ok: false, error: '地址不能为空' });
    expect(parseMcpForm(stdio, { isEdit: true }).ok).toBe(true);
    expect(parseMcpForm(http, { isEdit: true }).ok).toBe(true);
  });
});

describe('mcpUpdatePatch', () => {
  it('留空的连接字段不进补丁（保持原值）', () => {
    expect(
      mcpUpdatePatch({ transport: 'stdio', name: 's', command: '', args: [], env: {} }),
    ).toEqual({ name: 's' });
    expect(mcpUpdatePatch({ transport: 'http', name: 's', url: '', headers: {} })).toEqual({
      name: 's',
    });
  });

  it('填写过的字段进入补丁', () => {
    expect(
      mcpUpdatePatch({
        transport: 'stdio',
        name: 's',
        command: 'node',
        args: ['a.js'],
        env: { X: '1' },
      }),
    ).toEqual({ name: 's', command: 'node', args: ['a.js'], env: { X: '1' } });
    expect(
      mcpUpdatePatch({ transport: 'http', name: 's', url: 'https://a', headers: { A: '1' } }),
    ).toEqual({ name: 's', url: 'https://a', headers: { A: '1' } });
  });
});
