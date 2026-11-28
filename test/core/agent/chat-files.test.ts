import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, expect, it, vi } from 'vitest';
import {
  beginChatTool,
  branchChatFiles,
  chatFileHistory,
  endChatTool,
  flushChatFiles,
  freezeChatTurn,
  openChatWindow,
  readChatFileVersion,
  revertChatTurns,
  startChatTurn,
  userChatWrite,
  watchChatFiles,
  type AgentActor,
} from '../../../src/core/agent/chat-files';
import { readTurnFileChange } from '../../../src/core/agent/changes';
import { chatShareDirectory } from '../../../src/core/agent/session/store';
import { hostPorts } from '../../../src/core/ports';
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
const sources = async (sessionId: string, name: string) => {
  await flushChatFiles();
  return (await chatFileHistory(sessionId, `share/${name}`)).map(({ event: { source } }) =>
    source.kind === 'agent' ? `agent:${source.sessionId}` : source.kind,
  );
};

it('同归属的连续改动在 15 秒滑动窗口内合并，最多等 30 秒', async () => {
  const onCommit = vi.fn();
  const unwatch = watchChatFiles(() => false, onCommit);
  vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
  const id = randomUUID();
  const history = () => chatFileHistory(id, 'share/a.md');
  const save = (text: string) => userChatWrite([pathOf(id, 'a.md')], () => write(id, 'a.md', text));
  try {
    await history();
    save('first');
    expect(await history()).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(14_000);
    save('second');
    expect(await history()).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(14_000);
    save('third');
    expect(await history()).toHaveLength(0);
    expect(onCommit).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(2000);
    const snapshots = await history();
    expect(snapshots).toHaveLength(1);
    expect(onCommit).toHaveBeenCalledTimes(1);
    const [merged] = snapshots;
    expect(
      await readChatFileVersion(id, merged!.event.id, merged!.event.id, 'share/a.md'),
    ).toMatchObject({ status: 'added', after: 'third' });

    save('fourth');
    expect(await history()).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(14_999);
    expect(await history()).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(await history()).toHaveLength(2);
    expect(onCommit).toHaveBeenCalledTimes(2);
  } finally {
    unwatch();
    await flushChatFiles();
    vi.useRealTimers();
  }
});

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

  await freezeChatTurn(id, id, turnId, new Date().toISOString(), 'completed');
  expect(await readTurnFileChange(id, turnId, '/share/kept.md')).toMatchObject({
    before: 'v1',
    after: 'child',
  });
  expect(await chatFileHistory(id, 'share/kept.md')).toHaveLength(1);
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
  await branchChatFiles(source, target, 'entry', [second]);
  expect(read(target, 'notes/a.md')).toBe('user');

  const latest = randomUUID();
  await branchChatFiles(source, latest, 'entry', []);
  expect(read(latest, 'notes/a.md')).toBe('second');
  write(latest, 'notes/a.md', 'first');
  await revertChatTurns(latest, [first]);
  expect(read(latest, 'notes/a.md')).toBeNull();
});

it('重启后从版本库读回归属与历史，大文件只记录元数据', async () => {
  const id = randomUUID();
  const turnId = randomUUID();
  write(id, 'kept.md', 'v1');
  await startChatTurn(id, turnId);
  await runCommand(id, agent(id, turnId), () => {
    write(id, 'kept.md', 'model');
    write(id, 'large.bin', 'x'.repeat(5 * 1024 * 1024 + 1));
  });

  await flushChatFiles();
  const ports = hostPorts();
  vi.resetModules();
  (await import('../../../src/core/ports')).provideHostPorts(ports);
  const restarted = await import('../../../src/core/agent/chat-files');
  const history = await restarted.chatFileHistory(id, 'share/large.bin');
  expect(history.map(({ event }) => event.source.kind)).toEqual(['agent']);
  expect(history[0]!.change.after?.stored).toBe(false);
  const target = randomUUID();
  await restarted.branchChatFiles(id, target, 'entry', [turnId]);
  expect(read(target, 'kept.md')).toBe('v1');
  await restarted.revertChatTurns(id, [turnId]);
  expect(read(id, 'kept.md')).toBe('v1');
  expect(read(id, 'large.bin')).toBeNull();
});

it('一批写入失败后丢弃这批记录，后续读取与记录照常进行', async () => {
  const id = randomUUID();
  const turnId = randomUUID();
  write(id, 'a.md', 'v1');
  await chatFileHistory(id, 'share/a.md');
  await flushChatFiles();
  const objects = join(hostPorts().paths.userData(), 'chat-files', id, '.git', 'objects');
  renameSync(objects, `${objects}.bak`);
  writeFileSync(objects, '');
  await startChatTurn(id, turnId);
  await runCommand(id, agent(id, turnId), () => write(id, 'a.md', 'lost'));
  expect(await sources(id, 'a.md')).toEqual(['user']);
  rmSync(objects);
  renameSync(`${objects}.bak`, objects);

  await runCommand(id, agent(id, turnId), () => write(id, 'a.md', 'model'));
  expect(await sources(id, 'a.md')).toEqual(['user', 'user', `agent:${id}`]);
  await revertChatTurns(id, [turnId]);
  expect(read(id, 'a.md')).toBe('lost');
});
