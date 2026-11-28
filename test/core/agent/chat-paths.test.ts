import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { beforeEach, expect, it } from 'vitest';
import { foreignChatPath, virtualChatText } from '../../../src/core/agent/chat-paths';
import { hostPorts } from '../../../src/core/ports';
import { provideTestHostPorts } from '../host-mock';

beforeEach(() => {
  provideTestHostPorts({});
});

const storage = () => hostPorts().paths.storage();

it('回复中的聊天目录主机路径改写为 /privacy 与 /share', () => {
  const id = randomUUID();
  const share = join(storage(), 'chat-share', id);
  const privacy = join(storage(), 'chat-sessions', id);
  const windowsStyle = `${storage().replaceAll('/', '\\')}\\chat-share\\${id}\\out\\a.md`;

  expect(
    virtualChatText(
      `见 [报告](${share}/report.md)、file://${privacy}/draft.txt 和 ${windowsStyle}；目录 ${share}/`,
    ),
  ).toBe('见 [报告](/share/report.md)、/privacy/draft.txt 和 /share/out/a.md；目录 /share');
  expect(virtualChatText('/home/user/notes.md 与 /share/x.md 保持不变')).toBe(
    '/home/user/notes.md 与 /share/x.md 保持不变',
  );
});

it('只把其他会话的聊天目录识别为越界', () => {
  const owner = randomUUID();
  const other = randomUUID();
  expect(foreignChatPath(`cat ${join(storage(), 'chat-share', owner, 'a.md')}`, owner)).toBe(false);
  expect(foreignChatPath(`cat ${join(storage(), 'chat-sessions', other, 'a.md')}`, owner)).toBe(
    true,
  );
  expect(foreignChatPath('cat /etc/hosts /share/a.md', owner)).toBe(false);
});
