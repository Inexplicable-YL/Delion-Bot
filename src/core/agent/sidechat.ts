import { existsSync } from 'node:fs';
import type { AgentSession, AgentSessionEvent } from '@earendil-works/pi-coding-agent';
import {
  agentContract,
  type AgentToolResult,
  type ChatAskInput,
  type SidechatView,
  type WorkspaceChat,
} from '../protocol/agent';
import { agentEnvironment } from './environment';
import { releaseChatAttachments } from './media';
import { loadPi, openPiSession, writeSessionFile } from './pi';
import { usableLlmProviders } from './providers';
import { live } from './session/live';
import {
  projectMessages,
  snapshot,
  splitMeta,
  textOf,
  toolOutput,
  withoutToolImages,
} from './session/projection';
import { composePrompt } from './session/prompt';
import { launchPlan } from './sandbox/mode';
import { adoptSessionFile, readySelection, row } from './session/store';
import { emit } from '../ports';

interface Side {
  session: AgentSession;
  providerId: string;
  baseEntryIds: Set<string>;
  run?: { cancelled: boolean; tool?: string; done: Promise<void> };
  steps: Map<string, AgentToolResult>;
  streamedAt: number;
  unsubscribe: () => void;
}

const sides = new Map<string, Side>();
const opening = new Map<string, Promise<Side>>();

function messages(side: Side) {
  return side.session.sessionManager
    .buildSessionProjection()
    .entries.flatMap(({ sourceEntry, messages }) =>
      side.baseEntryIds.has(sourceEntry.id) ? [] : messages,
    );
}

function view(parentId: string, side: Side): SidechatView {
  return {
    parentId,
    running: Boolean(side.run),
    activeTool: side.run?.tool,
    messages: projectMessages(messages(side), side.steps, Boolean(side.run)),
  };
}

function publish(parentId: string, side: Side) {
  emit(agentContract, 'sidechat-update', view(parentId, side));
}

function stream(parentId: string, side: Side) {
  const now = Date.now();
  if (now - side.streamedAt < 100) return;
  side.streamedAt = now;
  const streaming = side.session.state.streamingMessage;
  const ownMessages = messages(side);
  const last = projectMessages(
    streaming ? [...ownMessages, streaming] : ownMessages,
    side.steps,
    true,
  ).at(-1);
  if (last?.role === 'assistant')
    emit(agentContract, 'sidechat-stream', {
      sessionId: parentId,
      message: withoutToolImages(last),
      activeTool: side.run?.tool,
    });
}

function onEvent(parentId: string, side: Side, event: AgentSessionEvent) {
  switch (event.type) {
    case 'tool_execution_start':
      side.steps.set(event.toolCallId, {
        id: event.toolCallId,
        name: event.toolName,
        input: event.args,
        startedAt: Date.now(),
      });
      if (side.run) side.run.tool = event.toolName;
      publish(parentId, side);
      break;
    case 'tool_execution_update': {
      const step = side.steps.get(event.toolCallId);
      if (step) step.output = toolOutput(event.partialResult ?? {});
      stream(parentId, side);
      break;
    }
    case 'tool_execution_end': {
      const step = side.steps.get(event.toolCallId);
      if (step) {
        step.output = {
          ...toolOutput(event.result ?? {}),
          ...(event.isError ? { isError: true } : {}),
        };
        step.finishedAt = Date.now();
      }
      if (side.run) side.run.tool = undefined;
      publish(parentId, side);
      break;
    }
    case 'message_update':
      stream(parentId, side);
      break;
    case 'message_end':
      queueMicrotask(() => publish(parentId, side));
      break;
  }
}

async function sidechatSource(id: string) {
  const meta = row(id);
  const { selection } = readySelection(meta);
  const entry = live.get(id);
  const manager =
    entry?.session.sessionManager ??
    (existsSync(meta.file) ? (await loadPi()).SessionManager.open(meta.file) : null);
  let branch = manager?.getBranch() ?? [];
  const turnId = entry?.run?.id;
  const asking = turnId
    ? branch.findIndex(
        (item) =>
          item.type === 'message' &&
          item.message.role === 'user' &&
          splitMeta(textOf(item.message.content)).meta.turnId === turnId,
      )
    : -1;
  if (asking >= 0) branch = branch.slice(0, asking);
  const plan = launchPlan(meta);
  return { meta, cwd: plan.hostCwd, piCwd: plan.piCwd, selection, branch };
}

async function createSide(parentId: string): Promise<Side> {
  const { meta, piCwd, selection, branch } = await sidechatSource(parentId);
  const pi = await loadPi();
  const inMemory = pi.SessionManager.inMemory(
    piCwd,
    meta.file ? { parentSession: meta.file } : undefined,
    branch,
  );
  const session = await openPiSession({
    cwd: piCwd,
    inMemory,
    selection,
    ...(await agentEnvironment().sessionOptions(meta.project_id, piCwd, {
      sessionId: parentId,
    })),
  });
  const side: Side = {
    session,
    providerId: selection.provider.id,
    baseEntryIds: new Set(session.sessionManager.getBranch().map(({ id }) => id)),
    steps: new Map(),
    streamedAt: 0,
    unsubscribe: () => {},
  };
  side.unsubscribe = session.subscribe((event) => onEvent(parentId, side, event));
  return side;
}

export async function openSidechat(parentId: string): Promise<SidechatView> {
  if (row(parentId).archived) throw new Error('请先恢复已归档的会话');
  const existing = sides.get(parentId);
  if (existing) return view(parentId, existing);
  let pending = opening.get(parentId);
  if (!pending) {
    pending = createSide(parentId).finally(() => opening.delete(parentId));
    opening.set(parentId, pending);
  }
  const side = await pending;
  if (row(parentId).archived) throw new Error('请先恢复已归档的会话');
  sides.set(parentId, side);
  return view(parentId, side);
}

function requireSide(parentId: string): Side {
  const side = sides.get(parentId);
  if (!side) throw new Error('旁问已关闭');
  return side;
}

export async function askSidechat(parentId: string, input: ChatAskInput): Promise<SidechatView> {
  const meta = row(parentId);
  if (meta.archived) throw new Error('请先恢复已归档的会话');
  const side = requireSide(parentId);
  if (side.run) throw new Error('请等待旁问回答完成');
  if (!usableLlmProviders().some(({ id }) => id === side.providerId))
    throw new Error('模型提供商已停用或不可用，请重新启用');
  const { prompt, images } = composePrompt(input, meta);
  let finish!: () => void;
  const run = { cancelled: false, done: new Promise<void>((resolve) => (finish = resolve)) };
  side.run = run;
  publish(parentId, side);
  try {
    await side.session.prompt(prompt, images.length ? { images } : undefined);
  } finally {
    releaseChatAttachments(input.attachments);
    side.run = undefined;
    side.steps.clear();
    if (sides.get(parentId) === side) publish(parentId, side);
    finish();
  }
  return view(parentId, side);
}

export function cancelSidechat(parentId: string) {
  const side = sides.get(parentId);
  if (side?.run) side.run.cancelled = true;
  void side?.session.abort();
}

export function sidechatBusy(parentId: string): boolean {
  return Boolean(sides.get(parentId)?.run || opening.has(parentId));
}

export async function closeSidechat(parentId: string): Promise<void> {
  const side = sides.get(parentId) ?? (await opening.get(parentId)?.catch(() => undefined));
  if (!side) return;
  sides.delete(parentId);
  if (side.run) {
    side.run.cancelled = true;
    await side.session.abort();
    await side.run.done;
  }
  side.unsubscribe();
  side.session.dispose();
  emit(agentContract, 'sidechat-closed', { parentId });
}

export async function keepSidechat(parentId: string): Promise<WorkspaceChat> {
  const side = requireSide(parentId);
  if (side.run) throw new Error('请等待旁问回答完成');
  if (!messages(side).length) throw new Error('旁问还没有内容');
  const manager = side.session.sessionManager;
  const header = manager.getHeader();
  if (!header) throw new Error('旁问记录缺少会话头');
  const file = writeSessionFile(header, manager.getEntries());
  const chat = snapshot(adoptSessionFile(row(parentId), file, '旁问：'));
  await closeSidechat(parentId);
  return chat;
}

export function hasSidechats(): boolean {
  return sides.size > 0;
}

export function shutdownSidechats(): Promise<void> {
  return Promise.all([...sides.keys()].map(closeSidechat)).then(() => {});
}
