import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import type { AgentSessionEvent } from '@earendil-works/pi-coding-agent';
import {
  agentContract,
  type AgentToolResult,
  type ChatAskInput,
  type ChatQueuedDraft,
  type RunStatus,
  type TaskNoticeDetails,
  type WorkspaceChat,
} from '../../protocol/agent';
import { emit, hostPorts } from '../../ports';
import { remoteBackend } from '../../remote/operations';
import * as changes from '../changes';
import { agentEnvironment } from '../environment';
import { chatAttachmentView, releaseChatAttachments } from '../media';
import { openPiSession } from '../pi';
import { taskTool, type SubagentResult } from '../subagent';
import { backgroundTools, stopAllTasks, type TaskNotice, type TaskParent } from '../tasks';
import { live, liveSteps, liveThinking, type Live, type Run } from './live';
import {
  encodeMeta,
  projectMessages,
  publish,
  queuedTexts,
  snapshot,
  thinkingKey,
  thinkingTimes,
  toolOutput,
  usageOf,
  withoutToolImages,
  TASK_NOTICE,
  THINKING_TIME,
} from './projection';
import { composePrompt } from './prompt';
import {
  isRemoteSession,
  readySelection,
  row,
  sessionCwd,
  storeActivity,
  storeModel,
  storeSessionFile,
  storeTitle,
} from './store';
import { generateSessionTitles } from './title';

export async function ensureLive(id: string): Promise<Live> {
  const existing = live.get(id);
  if (existing) return existing;
  const meta = row(id);
  const choice = readySelection(meta);
  const { selection } = choice;
  if (!choice.stored) storeModel(id, selection.provider.id, selection.model, selection.effort);
  const cwd = sessionCwd(meta.project_id, meta.cwd);
  const options = await agentEnvironment().sessionOptions(meta.project_id, cwd, {
    askCards: !meta.parent_id,
  });
  const delegates = !meta.parent_id;
  const remote = meta.project_id ? hostPorts().projects.remoteOf(meta.project_id) : null;
  const parent: TaskParent = {
    id,
    publish: () => publish(id),
    deliver: (notice, wake) => deliverTaskNotice(id, notice, wake),
  };
  const session = await openPiSession({
    cwd,
    file: existsSync(meta.file) ? meta.file : undefined,
    selection,
    ...options,
    ...(delegates
      ? {
          customTools: [
            ...options.customTools,
            ...(await backgroundTools(
              parent,
              cwd,
              options.shellPath,
              options.commandPrefix,
              remote && remoteBackend(remote.target),
            )),
            taskTool(parent, cwd, runSubagent),
          ],
        }
      : {}),
    ...(meta.parent_id ? { parentSession: row(meta.parent_id).file } : {}),
    beforeTool: () => live.get(id)?.run?.captured,
  });
  if (session.sessionFile && session.sessionFile !== meta.file)
    storeSessionFile(id, session.sessionFile);
  const entry: Live = { session, cwd, providerId: selection.provider.id, unsubscribe: () => {} };
  entry.unsubscribe = session.subscribe((event) => onEvent(id, entry, event));
  live.set(id, entry);
  return entry;
}

export function disposeLive(id: string, entry: Live): void {
  entry.unsubscribe();
  live.delete(id);
  entry.session.dispose();
}

export async function shutdownSessions(timeoutMs: number): Promise<void> {
  const tasks = stopAllTasks();
  for (const [id, entry] of [...live]) {
    if (entry.run) entry.run.cancelled = true;
    disposeLive(id, entry);
  }
  await Promise.race([tasks, new Promise((resolve) => setTimeout(resolve, timeoutMs))]);
}

export function hasLiveSessions(): boolean {
  return live.size > 0;
}

export function invalidateSessions(providerId?: string) {
  for (const [id, entry] of live) {
    if (providerId && entry.providerId !== providerId) continue;
    if (!entry.run && !entry.session.isCompacting) disposeLive(id, entry);
    else {
      entry.stale = true;
    }
  }
}

const streamTimers = new Map<string, number>();

function onEvent(id: string, entry: Live, event: AgentSessionEvent) {
  const steps = liveSteps.get(id) ?? new Map<string, AgentToolResult>();
  liveSteps.set(id, steps);
  switch (event.type) {
    case 'tool_execution_start':
      steps.set(event.toolCallId, {
        id: event.toolCallId,
        name: event.toolName,
        input: event.args,
        startedAt: Date.now(),
      });
      if (entry.run) entry.run.tool = event.toolName;
      runEvent(id, 'running', event.toolName);
      publish(id);
      break;
    case 'tool_execution_update': {
      const step = steps.get(event.toolCallId);
      if (step) step.output = toolOutput(event.partialResult ?? {});
      stream(id, entry);
      break;
    }
    case 'tool_execution_end': {
      const step = steps.get(event.toolCallId);
      if (step) {
        step.output = {
          ...toolOutput(event.result ?? {}),
          ...(event.isError ? { isError: true } : {}),
        };
        step.finishedAt = Date.now();
      }
      if (entry.run) entry.run.tool = undefined;
      runEvent(id, 'running');
      publish(id);
      break;
    }
    case 'message_update': {
      const update = event.assistantMessageEvent;
      const times = liveThinking.get(id);
      if (times && update.type === 'thinking_start')
        times.set(thinkingKey(update.partial.timestamp, update.contentIndex), {
          startedAt: Date.now(),
        });
      else if (times && update.type === 'thinking_end') {
        const time = times.get(thinkingKey(update.partial.timestamp, update.contentIndex));
        if (time) time.finishedAt = Date.now();
      }
      stream(id, entry);
      break;
    }
    case 'compaction_end':
      if (event.result?.estimatedTokensAfter !== undefined)
        entry.compactedTokens = event.result.estimatedTokensAfter;
      touch(id, entry);
      publish(id);
      break;
    case 'message_end':
    case 'compaction_start':
      touch(id, entry);
      publish(id);
      break;
    case 'queue_update':
      emit(agentContract, 'queue', {
        sessionId: id,
        queued: queuedTexts(event.steering),
      });
      break;
  }
}

function stream(id: string, entry: Live) {
  const now = Date.now();
  if (now - (streamTimers.get(id) ?? 0) < 100) return;
  streamTimers.set(id, now);
  const streaming = entry.session.state.streamingMessage;
  const messages = projectMessages(
    streaming ? [...entry.session.messages, streaming] : entry.session.messages,
    liveSteps.get(id),
    true,
    undefined,
    thinkingTimes(entry.session.sessionManager, liveThinking.get(id)),
  );
  const last = messages.at(-1);
  if (last?.role === 'assistant')
    emit(agentContract, 'session-stream', {
      sessionId: id,
      message: withoutToolImages(last),
      activeTool: entry.run?.tool,
      contextUsage: usageOf(entry),
    });
}

function touch(id: string, entry: Live) {
  storeActivity(id, entry.session.messages.filter((m) => m.role === 'user').length);
}

function runEvent(
  sessionId: string,
  status: RunStatus,
  activeTool?: string,
  finishedRunId?: string,
  changesError?: string,
) {
  const entry = live.get(sessionId);
  emit(agentContract, 'run-event', {
    sessionId,
    runId: finishedRunId ?? entry?.run?.id ?? '',
    status,
    activeTool,
    ...(changesError ? { changesError } : {}),
  });
}

export async function runSubagent(
  id: string,
  prompt: string,
  signal: AbortSignal | undefined,
  onEvent: (event: AgentSessionEvent) => void,
): Promise<SubagentResult> {
  const entry = await ensureLive(id);
  if (entry.run || entry.session.isCompacting)
    throw new Error('这个子 Agent 还在运行，等它结束再续接');
  if (signal?.aborted) return { status: 'stopped', reply: null };
  const turnId = randomUUID();
  const priorCount = entry.session.messages.length;
  const unsubscribe = entry.session.subscribe(onEvent);
  const stop = () => cancelRun(id);
  signal?.addEventListener('abort', stop, { once: true });
  try {
    const status = await runTurn(id, entry, turnId, [], () =>
      entry.session.prompt(`${encodeMeta({ turnId, body: prompt })}${prompt}`),
    );
    const last = entry.session.messages.slice(priorCount).findLast((m) => m.role === 'assistant');
    if (last?.role !== 'assistant') return { status, reply: null };
    const reply = last.content
      .flatMap((block) => (block.type === 'text' ? [block.text] : []))
      .join('\n\n')
      .trim();
    return {
      status,
      reply: reply || null,
      ...(last.stopReason === 'error' ? { error: last.errorMessage ?? '未知错误' } : {}),
    };
  } finally {
    signal?.removeEventListener('abort', stop);
    unsubscribe();
  }
}

export function cancelRun(id: string): ChatQueuedDraft | null {
  const entry = live.get(id);
  const queued = entry?.run ? queuedDraft(takeSteers(entry, entry.run)) : null;
  if (entry?.run) entry.run.cancelled = true;
  void entry?.session.abort();
  return queued;
}

export function withdrawQueued(id: string): ChatQueuedDraft | null {
  const entry = live.get(id);
  if (!entry?.run) return null;
  const draft = queuedDraft(takeSteers(entry, entry.run));
  for (const notice of undeliveredNotices(entry, entry.run))
    void entry.session.sendCustomMessage(noticeMessage(notice));
  return draft;
}

const noticeMessage = (notice: TaskNotice) => ({
  customType: TASK_NOTICE,
  content: notice.text,
  display: true,
  details: notice.details,
});

function undeliveredNotices(entry: Live, run: Run): TaskNotice[] {
  const delivered = new Set(
    entry.session.messages.flatMap((message) =>
      message.role === 'custom' && message.customType === TASK_NOTICE
        ? [(message.details as TaskNoticeDetails).noticeId]
        : [],
    ),
  );
  return run.notices.filter((notice) => !delivered.has(notice.details.noticeId));
}

async function deliverTaskNotice(id: string, notice: TaskNotice, wake: boolean): Promise<void> {
  const entry = await ensureLive(id);
  if (!wake) {
    await entry.session.sendCustomMessage(noticeMessage(notice), { triggerTurn: false });
    return;
  }
  const run = entry.run;
  if (run && !run.finishing && !run.cancelled && entry.session.isStreaming) {
    run.notices.push(notice);
    await entry.session.sendCustomMessage(noticeMessage(notice));
    return;
  }
  if (run || entry.session.isCompacting) {
    await (run ? run.done : entry.session.waitForIdle());
    return deliverTaskNotice(id, notice, wake);
  }
  const turnId = randomUUID();
  const message = noticeMessage({ ...notice, details: { ...notice.details, turnId } });
  await runTurn(id, entry, turnId, [], () =>
    entry.session.sendCustomMessage(message, { triggerTurn: true }),
  );
}

function takeSteers(entry: Live, run: Run) {
  return entry.session.clearQueue().steering.flatMap((prompt) => {
    const index = run.steers.findIndex((steer) => steer.prompt === prompt);
    return index < 0 ? [] : run.steers.splice(index, 1).map(({ input }) => input);
  });
}

function queuedDraft(inputs: ChatAskInput[]): ChatQueuedDraft | null {
  if (!inputs.length) return null;
  return {
    text: inputs
      .map(({ text }) => text)
      .filter((text) => text.trim())
      .join('\n\n'),
    comments: inputs.flatMap(({ comments }) => comments),
    attachments: inputs.flatMap(({ attachments }) => attachments.map(chatAttachmentView)),
  };
}

export async function askSession(id: string, input: ChatAskInput): Promise<WorkspaceChat> {
  if (row(id).parent_id) throw new Error('子 Agent 的会话只读');
  const entry = await ensureLive(id);
  const current = entry.run;
  if (current && !input.replaceLastUser) {
    if (!current.finishing && !current.cancelled) return steerRun(id, entry, current, input);
    await current.done;
    return askSession(id, input);
  }
  if (entry.run) throw new Error('请等待当前回答完成');
  if (entry.session.isCompacting) throw new Error('正在压缩上下文，请稍候');
  const meta = row(id);
  const { prompt, userText, images, attachments, comments, turnId } = composePrompt(
    input,
    meta.project_id,
  );
  if (input.replaceLastUser) {
    const branch = entry.session.sessionManager.getBranch();
    const lastUser = [...branch]
      .reverse()
      .find((item) => item.type === 'message' && item.message.role === 'user');
    if (!lastUser) throw new Error('没有可编辑的消息');
    if (lastUser.parentId) entry.session.sessionManager.branch(lastUser.parentId);
    else entry.session.sessionManager.resetLeaf();
    entry.session.agent.state.messages =
      entry.session.sessionManager.buildSessionContext().messages;
  }
  if (
    !input.replaceLastUser &&
    meta.title_temporary &&
    !entry.session.messages.some((message) => message.role === 'user')
  ) {
    storeTitle(
      id,
      userText || comments[0]?.comment || comments[0]?.quote || attachments[0]?.name || '图片请求',
      Boolean(userText),
    );
    if (userText) generateSessionTitles(id, userText);
  }
  await runTurn(id, entry, turnId, input.attachments, () =>
    entry.session.prompt(prompt, images.length ? { images } : undefined),
  );
  return snapshot(id);
}

type TurnStatus = 'completed' | 'failed' | 'stopped';

async function runTurn(
  id: string,
  entry: Live,
  turnId: string,
  attachments: string[],
  start: () => Promise<void>,
): Promise<TurnStatus> {
  const meta = row(id);
  const child = meta.parent_id !== null;
  let finishRun!: () => void;
  const run: Run = {
    id: turnId,
    cancelled: false,
    steers: [],
    notices: [],
    done: new Promise<void>((resolve) => {
      finishRun = resolve;
    }),
  };
  entry.run = run;
  liveSteps.set(id, new Map());
  liveThinking.set(id, new Map());
  runEvent(id, 'running');
  let status: TurnStatus = 'completed';
  const startedAt = new Date().toISOString();
  let before: changes.DirectorySnapshot | null = null;
  let captureError: string | undefined;
  try {
    if (isRemoteSession(meta)) captureError = '远程会话暂不记录目录快照';
    else if (!child)
      run.captured = changes.captureDirectory(entry.cwd).then(
        (snapshot) => {
          before = snapshot;
        },
        (error: unknown) => {
          captureError = error instanceof Error ? error.message : String(error);
        },
      );
    const priorCount = entry.session.messages.length;
    if (run.cancelled) status = 'stopped';
    else await start();
    const last = entry.session.messages.slice(priorCount).findLast((m) => m.role === 'assistant');
    if (run.cancelled || (last?.role === 'assistant' && last.stopReason === 'aborted'))
      status = 'stopped';
    else if (last?.role === 'assistant' && last.stopReason === 'error') status = 'failed';
  } catch (error) {
    status = 'failed';
    throw error;
  } finally {
    run.finishing = true;
    let changesError: string | undefined;
    try {
      await run.captured;
      if (!child)
        await changes.freezeTurnChanges(
          id,
          turnId,
          entry.cwd,
          startedAt,
          status,
          before,
          captureError,
        );
    } catch (error) {
      changesError = error instanceof Error ? error.message : String(error);
    }
    const orphaned = takeSteers(entry, run);
    const lostNotices = undeliveredNotices(entry, run);
    try {
      releaseChatAttachments([
        ...attachments,
        ...run.steers.flatMap((steer) => steer.input.attachments),
      ]);
      const finishedThinking = [...(liveThinking.get(id) ?? [])].filter(
        ([, time]) => time.finishedAt !== undefined,
      );
      if (finishedThinking.length)
        entry.session.sessionManager.appendCustomEntry(
          THINKING_TIME,
          Object.fromEntries(finishedThinking),
        );
      entry.run = undefined;
      liveSteps.delete(id);
      liveThinking.delete(id);
      if (entry.session.sessionFile) storeSessionFile(id, entry.session.sessionFile);
      touch(id, entry);
      runEvent(id, status, undefined, turnId, changesError);
      publish(id);
      if (status !== 'stopped' && !child) hostPorts().notifier.notifyRunFinished(id, status);
      if (entry.stale) disposeLive(id, entry);
    } finally {
      finishRun();
    }
    for (const steer of orphaned)
      void askSession(id, steer).catch((error: unknown) =>
        console.error('插队消息发送失败', error),
      );
    for (const notice of lostNotices)
      void deliverTaskNotice(id, notice, !run.cancelled).catch((error: unknown) =>
        console.error('后台任务通知投递失败', error),
      );
  }
  return status;
}

async function steerRun(id: string, entry: Live, run: Run, input: ChatAskInput) {
  const { prompt, images } = composePrompt(input, row(id).project_id, run.id);
  await entry.session.steer(prompt, images.length ? images : undefined);
  run.steers.push({ prompt, input });
  return snapshot(id);
}
