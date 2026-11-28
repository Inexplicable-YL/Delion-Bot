import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, expect, it } from 'vitest';
import {
  branchChatFiles,
  chatFileHistory,
  recordChatFiles,
  revertChatTurns,
} from '../../../src/core/agent/chat-files';
import { chatShareDirectory } from '../../../src/core/agent/session/store';
import { provideTestHostPorts } from '../host-mock';

beforeEach(() => {
  provideTestHostPorts({});
});

const write = (sessionId: string, name: string, text: string) => {
  const path = join(chatShareDirectory(sessionId), name);
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, text);
};
const read = (sessionId: string, name: string) => {
  const path = join(chatShareDirectory(sessionId), name);
  return existsSync(path) ? readFileSync(path, 'utf8') : null;
};
const turn = (sessionId: string, turnId: string) =>
  recordChatFiles(sessionId, { kind: 'turn', sessionId, turnId });

it('重试只撤销模型改动，保留用户之后对同一文件的修改', async () => {
  const id = randomUUID();
  write(id, 'kept.md', 'v1');
  write(id, 'edited.md', 'v1');
  write(id, 'removed.md', 'v1');
  await recordChatFiles(id, { kind: 'user' });
  const turnId = randomUUID();
  write(id, 'kept.md', 'model');
  write(id, 'edited.md', 'model');
  write(id, 'created.md', 'model');
  rmSync(join(chatShareDirectory(id), 'removed.md'));
  await turn(id, turnId);
  write(id, 'edited.md', 'user');

  await revertChatTurns(id, [turnId]);

  expect(read(id, 'kept.md')).toBe('v1');
  expect(read(id, 'edited.md')).toBe('user');
  expect(read(id, 'created.md')).toBeNull();
  expect(read(id, 'removed.md')).toBe('v1');
  expect(
    (await chatFileHistory(id, 'share/edited.md', false)).map(({ event }) => event.source.kind),
  ).toEqual(['user', 'turn', 'user']);
});

it('分支拷贝下一轮开始前的文件状态，并能在新会话撤销继承的轮次', async () => {
  const source = randomUUID();
  const first = randomUUID();
  const second = randomUUID();
  await recordChatFiles(source, { kind: 'user' });
  write(source, 'notes/a.md', 'first');
  await turn(source, first);
  write(source, 'notes/a.md', 'user');
  await recordChatFiles(source, { kind: 'user' });
  write(source, 'notes/a.md', 'second');
  await turn(source, second);

  const target = randomUUID();
  await branchChatFiles(source, target, 'entry', second, [first]);
  expect(read(target, 'notes/a.md')).toBe('user');

  const retried = randomUUID();
  await branchChatFiles(source, retried, 'entry', undefined, [first]);
  expect(read(retried, 'notes/a.md')).toBe('second');
  write(retried, 'notes/a.md', 'first');
  await revertChatTurns(retried, [first]);
  expect(read(retried, 'notes/a.md')).toBeNull();
});
