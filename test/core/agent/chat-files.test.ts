import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, expect, it } from 'vitest';
import {
  beginChatTool,
  branchChatFiles,
  chatFileHistory,
  endChatTool,
  openChatWindow,
  revertChatTurns,
  startChatTurn,
  userChatWrite,
  type AgentActor,
} from '../../../src/core/agent/chat-files';
import { chatShareDirectory } from '../../../src/core/agent/session/store';
import { provideTestHostPorts } from '../host-mock';

beforeEach(() => {
  provideTestHostPorts({});
});

const pathOf = (sessionId: string, name: string) => join(chatShareDirectory(sessionId), name);
const write = (sessionId: string, name: string, text: string) => {
  mkdirSync(join(pathOf(sessionId, name), '..'), { recursive: true });
  writeFileSync(pathOf(sessionId, name), text);
};
const read = (sessionId: string, name: string) =>
  existsSync(pathOf(sessionId, name)) ? readFileSync(pathOf(sessionId, name), 'utf8') : null;
const agent = (sessionId: string, turnId: string, parentTurnId?: string): AgentActor => ({
  kind: 'agent',
  sessionId,
  turnId,
  ...(parentTurnId && { parentTurnId }),
});
const runCommand = async (owner: string, actor: AgentActor, work: () => void) => {
  const close = await openChatWindow(owner, actor, true);
  work();
  await close();
};
const sources = async (sessionId: string, name: string) =>
  (await chatFileHistory(sessionId, `share/${name}`)).map(({ to }) =>
    to.source.kind === 'agent' ? `agent:${to.source.sessionId}` : to.source.kind,
  );

it('Agent 运行期间交错的用户改动与 Agent 改动各自归属', async () => {
  const id = randomUUID();
  const turnId = randomUUID();
  await startChatTurn(id, turnId);
  const actor = agent(id, turnId);
  await beginChatTool(id, actor, {
    toolName: 'write',
    toolCallId: 'w1',
    input: { path: '/share/report.md' },
  });
  write(id, 'report.md', 'agent draft');
  userChatWrite([pathOf(id, 'notes.md')], () => write(id, 'notes.md', 'user note'));
  await endChatTool(id, 'w1');
  await new Promise((resolve) => setTimeout(resolve, 0));
  userChatWrite([pathOf(id, 'report.md')], () => write(id, 'report.md', 'user fix'));
  await new Promise((resolve) => setTimeout(resolve, 0));
  await runCommand(id, actor, () => write(id, 'report.md', 'agent final'));

  expect(await sources(id, 'notes.md')).toEqual(['user']);
  expect(await sources(id, 'report.md')).toEqual([`agent:${id}`, 'user', `agent:${id}`]);
});

it('子 Agent 的改动记在子会话名下，并随主轮次一起撤销', async () => {
  const id = randomUUID();
  const child = randomUUID();
  const turnId = randomUUID();
  write(id, 'kept.md', 'v1');
  await startChatTurn(id, turnId);
  await runCommand(id, agent(child, randomUUID(), turnId), () => write(id, 'kept.md', 'child'));
  write(id, 'other.md', 'user');

  expect(await sources(id, 'kept.md')).toEqual(['user', `agent:${child}`]);
  await revertChatTurns(id, [turnId]);
  expect(read(id, 'kept.md')).toBe('v1');
  expect(read(id, 'other.md')).toBe('user');
});

it('重试只撤销模型改动，保留用户之后对同一文件的修改', async () => {
  const id = randomUUID();
  write(id, 'kept.md', 'v1');
  write(id, 'edited.md', 'v1');
  write(id, 'removed.md', 'v1');
  const turnId = randomUUID();
  await startChatTurn(id, turnId);
  await runCommand(id, agent(id, turnId), () => {
    write(id, 'kept.md', 'model');
    write(id, 'edited.md', 'model');
    write(id, 'created.md', 'model');
    rmSync(pathOf(id, 'removed.md'));
  });
  write(id, 'edited.md', 'user');

  await revertChatTurns(id, [turnId]);

  expect(read(id, 'kept.md')).toBe('v1');
  expect(read(id, 'edited.md')).toBe('user');
  expect(read(id, 'created.md')).toBeNull();
  expect(read(id, 'removed.md')).toBe('v1');
  expect(await sources(id, 'edited.md')).toEqual(['user', `agent:${id}`, 'user']);
});

it('分支拷贝下一轮开始前的文件状态，并能在新会话撤销继承的轮次', async () => {
  const source = randomUUID();
  const first = randomUUID();
  const second = randomUUID();
  await startChatTurn(source, first);
  await runCommand(source, agent(source, first), () => write(source, 'notes/a.md', 'first'));
  write(source, 'notes/a.md', 'user');
  await startChatTurn(source, second);
  await runCommand(source, agent(source, second), () => write(source, 'notes/a.md', 'second'));

  const target = randomUUID();
  await branchChatFiles(source, target, 'entry', second, [first]);
  expect(read(target, 'notes/a.md')).toBe('user');

  const latest = randomUUID();
  await branchChatFiles(source, latest, 'entry', undefined, [first]);
  expect(read(latest, 'notes/a.md')).toBe('second');
  write(latest, 'notes/a.md', 'first');
  await revertChatTurns(latest, [first]);
  expect(read(latest, 'notes/a.md')).toBeNull();
});
