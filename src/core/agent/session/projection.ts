import { existsSync } from 'node:fs';
import type { AgentSession, SessionEntry, SessionManager } from '@earendil-works/pi-coding-agent';
import type { AgentMessage } from '@earendil-works/pi-agent-core';
import type { ImageContent, TextContent } from '@earendil-works/pi-ai';
import { z } from 'zod';
import type {
  AgentToolResult,
  ContextUsageView,
  TaskNoticeDetails,
  WorkspaceChat,
} from '../../protocol/agent';
import { emit } from '../../ports';
import { agentContract } from '../../protocol/agent';
import { executionMode } from '../sandbox/mode';
import { runningTasks } from '../tasks';
import { live, liveSteps, liveThinking, type Live, type ThinkingTime } from './live';
import { modelChoice, requirePiSync, row, sessionCwd, type ModelChoice } from './store';

type ChatMessage = WorkspaceChat['messages'][number];

export const TASK_NOTICE = 'delion-task';

export const THINKING_TIME = 'delion-thinking-time';

export const COMPACTION_DETAILS = 'delion-compaction-details';

const storedCompaction = z.object({
  id: z.string(),
  mode: z.enum(['manual', 'auto']),
  releasedTokens: z.number().optional(),
});

type CompactionHistoryMessage = ChatMessage & {
  compaction?: Omit<z.infer<typeof storedCompaction>, 'id'>;
};

export const thinkingKey = (timestamp: number, contentIndex: number) =>
  `${timestamp}:${contentIndex}`;

const storedThinking = z.record(
  z.string(),
  z.object({ startedAt: z.number(), finishedAt: z.number() }),
);

export function thinkingTimes(
  manager: Pick<SessionManager, 'getBranch'>,
  pending?: ReadonlyMap<string, ThinkingTime>,
): Map<string, ThinkingTime> {
  const times = new Map<string, ThinkingTime>();
  for (const entry of manager.getBranch()) {
    if (entry.type !== 'custom' || entry.customType !== THINKING_TIME) continue;
    const stored = storedThinking.safeParse(entry.data);
    if (stored.success) for (const [key, time] of Object.entries(stored.data)) times.set(key, time);
  }
  for (const [key, time] of pending ?? []) times.set(key, time);
  return times;
}

export const textOf = (content: string | (TextContent | ImageContent)[]) =>
  typeof content === 'string'
    ? content
    : content.flatMap((block) => (block.type === 'text' ? [block.text] : [])).join('');

const META_PREFIX = '<delion-meta>';
const META_SUFFIX = '</delion-meta>\n';

type UserMessageMeta = Omit<Partial<ChatMessage>, 'attachments'> & {
  body?: string;
  attachments?: { id?: string; name: string }[];
};

export const encodeMeta = (meta: UserMessageMeta & { turnId: string }) =>
  `${META_PREFIX}${JSON.stringify(meta)}${META_SUFFIX}`;

export function splitMeta(text: string): { meta: UserMessageMeta; text: string; rest?: string } {
  if (!text.startsWith(META_PREFIX)) return { meta: {}, text };
  const end = text.indexOf(META_SUFFIX);
  if (end < 0) return { meta: {}, text };
  try {
    const meta = JSON.parse(text.slice(META_PREFIX.length, end)) as UserMessageMeta;
    return { meta, text: meta.body ?? '', rest: text.slice(end + META_SUFFIX.length) };
  } catch {
    return { meta: {}, text };
  }
}

export const queuedTexts = (steering: readonly string[]) =>
  steering.map((text) => splitMeta(text).text);

export function toolOutput(result: {
  content?: (TextContent | ImageContent)[];
  details?: unknown;
}) {
  const image = (result.content ?? []).find((block) => block.type === 'image');
  return {
    text: textOf(result.content ?? []),
    ...(image ? { image: { mimeType: image.mimeType, data: image.data } } : {}),
    ...(result.details !== undefined ? { details: result.details } : {}),
  };
}

export function projectMessages(
  messages: AgentMessage[],
  pending?: Map<string, AgentToolResult>,
  running = false,
  entryIds?: (string | undefined)[],
  thinking?: ReadonlyMap<string, ThinkingTime>,
): ChatMessage[] {
  const out: ChatMessage[] = [];
  let reply: ChatMessage | null = null;
  let lastUserAt = 0;
  let lastTurnId: string | undefined;
  const results = new Map<string, AgentToolResult>();
  for (const [index, message] of messages.entries()) {
    const entryId = entryIds?.[index];
    if (message.role === 'user') {
      lastUserAt = message.timestamp;
      const { meta, text } = splitMeta(textOf(message.content));
      lastTurnId = meta.turnId;
      out.push({ role: 'user', content: text, ...meta, startedAt: message.timestamp });
      reply = null;
    } else if (message.role === 'assistant') {
      if (!reply) {
        reply = {
          role: 'assistant',
          content: '',
          parts: [],
          toolResults: [],
          startedAt: lastUserAt || message.timestamp,
          ...(lastTurnId ? { turnId: lastTurnId } : {}),
        };
        out.push(reply);
      }
      for (const [contentIndex, block] of message.content.entries()) {
        if (block.type === 'thinking' && block.thinking.trim())
          reply.parts!.push({
            type: 'reasoning',
            text: block.thinking,
            ...thinking?.get(thinkingKey(message.timestamp, contentIndex)),
          });
        else if (block.type === 'text' && block.text)
          reply.parts!.push({ type: 'text', text: block.text });
        else if (block.type === 'toolCall') {
          const step: AgentToolResult = pending?.get(block.id) ?? {
            id: block.id,
            name: block.name,
            input: block.arguments,
          };
          results.set(block.id, step);
          const last = reply.parts!.at(-1);
          if (last?.type === 'tools') last.results.push(step);
          else reply.parts!.push({ type: 'tools', results: [step] });
          reply.toolResults!.push(step);
        }
      }
      reply.content = reply
        .parts!.flatMap((part) => (part.type === 'text' ? [part.text] : []))
        .join('\n\n');
      if (message.stopReason === 'aborted') reply.stopped = true;
      if (message.stopReason === 'error') {
        reply.interrupted = true;
        const notice = `本次执行中断：${message.errorMessage ?? '未知错误'}`;
        reply.parts!.push({ type: 'text', text: notice });
        reply.content = reply.content ? `${reply.content}\n\n${notice}` : notice;
      }
      reply.finishedAt = message.timestamp + (message.durationMs ?? 0);
      if (entryId) reply.entryId = entryId;
    } else if (message.role === 'toolResult') {
      const step = results.get(message.toolCallId);
      if (step) {
        step.output = { ...toolOutput(message), ...(message.isError ? { isError: true } : {}) };
        step.finishedAt = message.timestamp;
      }
      if (entryId && reply) reply.entryId = entryId;
    } else if (message.role === 'custom' && message.customType === TASK_NOTICE) {
      const details = message.details as TaskNoticeDetails;
      if (details.turnId) {
        lastUserAt = message.timestamp;
        lastTurnId = details.turnId;
      }
      out.push({
        role: 'assistant',
        content: textOf(message.content),
        parts: [],
        task: details,
        startedAt: message.timestamp,
      });
      reply = null;
    } else if (message.role === 'custom') {
      if (message.display) {
        out.push({
          role: 'assistant',
          content: textOf(message.content),
          startedAt: message.timestamp,
          parts: [],
          extension: { customType: message.customType },
        });
        reply = null;
      }
    } else if (message.role === 'compactionSummary') {
      out.push({
        role: 'assistant',
        content: '（较早的对话已压缩为摘要）',
        parts: [],
        compacted: true,
      });
      reply = null;
    }
  }
  const last = out.at(-1);
  if (running && last?.role === 'assistant') {
    delete last.finishedAt;
    delete last.entryId;
  }
  if (running && (last?.role === 'user' || last?.task))
    out.push({
      role: 'assistant',
      content: '',
      parts: [],
      toolResults: [],
      startedAt: lastUserAt,
      ...(lastTurnId ? { turnId: lastTurnId } : {}),
    });
  return out;
}

function storedMessages(
  manager: Pick<SessionManager, 'buildSessionProjection' | 'getBranch'>,
): ChatMessage[] {
  const projected = manager
    .buildSessionProjection()
    .entries.flatMap(({ sourceEntry, messages }) =>
      messages.map((message) => ({ sourceEntry, message })),
    );
  return projectMessages(
    projected.map(({ message }) => message),
    undefined,
    false,
    projected.map(({ sourceEntry }) =>
      sourceEntry.type === 'message' ? sourceEntry.id : undefined,
    ),
    thinkingTimes(manager),
  );
}

export function projectCompactionHistory(branch: SessionEntry[]): CompactionHistoryMessage[] {
  const cutoff = branch.findLastIndex(({ type }) => type === 'compaction');
  if (cutoff < 0) return [];
  const entries = branch.slice(0, cutoff + 1);
  const details = new Map<string, z.infer<typeof storedCompaction>>();
  for (const entry of branch) {
    if (entry.type !== 'custom' || entry.customType !== COMPACTION_DETAILS) continue;
    const parsed = storedCompaction.safeParse(entry.data);
    if (parsed.success) details.set(parsed.data.id, parsed.data);
  }
  const { sessionEntryToContextMessages } = requirePiSync();
  const projected = entries.flatMap((entry) =>
    sessionEntryToContextMessages(entry).map((message) => ({ message, id: entry.id })),
  );
  const inserted = entries.filter((entry) => entry.type === 'compaction').values();
  return projectMessages(
    projected.map(({ message }) => message),
    undefined,
    false,
    projected.map(({ id }) => id),
    thinkingTimes({ getBranch: () => branch }),
  ).map((message) => {
    if (!message.compacted) return message;
    const entry = inserted.next().value!;
    const detail = details.get(entry.id);
    return {
      ...message,
      entryId: entry.id,
      content: entry.summary,
      startedAt: Date.parse(entry.timestamp),
      ...(detail && { compaction: { mode: detail.mode, releasedTokens: detail.releasedTokens } }),
    };
  });
}

export function projectAfterCompaction(id: string, branch: SessionEntry[], streaming = false) {
  const boundary = branch.findLastIndex(({ type }) => type === 'compaction');
  if (boundary < 0) return null;
  const entry = live.get(id);
  const running = Boolean(entry?.run);
  const projection =
    entry?.session.sessionManager.buildSessionProjection() ??
    requirePiSync().buildSessionProjection(branch);
  const start = projection.entries.findIndex(
    ({ sourceEntry }) => sourceEntry.parentId === branch[boundary]!.id,
  );
  const finalized =
    start < 0
      ? []
      : projection.entries.slice(start).flatMap(({ sourceEntry, messages }) =>
          messages.map((message) => ({
            message,
            id: sourceEntry.type === 'message' ? sourceEntry.id : undefined,
          })),
        );
  const pending = running ? entry!.session.messages.slice(projection.messages.length) : [];
  const partial = streaming ? entry?.session.state.streamingMessage : null;
  const messages = [...finalized.map(({ message }) => message), ...pending];
  if (partial) messages.push(partial);
  const source =
    messages.length > 0 && messages[0]?.role !== 'user'
      ? branch
          .slice(0, boundary)
          .findLast((item) => item.type === 'message' && item.message.role === 'user')
      : undefined;
  const seed = source?.type === 'message' ? [source.message] : [];
  const suffix = projectMessages(
    [...seed, ...messages],
    running ? liveSteps.get(id) : undefined,
    running,
    [...seed.map(() => undefined), ...finalized.map((item) => item.id)],
    thinkingTimes({ getBranch: () => branch }, liveThinking.get(id)),
  ).slice(seed.length);
  return { entryId: branch[boundary]!.id, messages: suffix };
}

function readMessages(id: string): ChatMessage[] {
  const file = row(id).file;
  if (!existsSync(file)) return [];
  try {
    const { SessionManager } = requirePiSync();
    return storedMessages(SessionManager.open(file));
  } catch {
    return [];
  }
}

export function withoutToolImages(message: ChatMessage): ChatMessage {
  const strip = (step: AgentToolResult): AgentToolResult => {
    if (!step.output?.image) return step;
    const { image: _image, ...output } = step.output;
    return { ...step, output };
  };
  const parts = message.parts?.map((part) =>
    part.type === 'tools' ? { ...part, results: part.results.map(strip) } : part,
  );
  return {
    ...message,
    ...(message.toolResults && { toolResults: message.toolResults.map(strip) }),
    ...(parts && { parts }),
  };
}

export function usageOf(entry: Live | undefined): ContextUsageView | null {
  return entry ? contextUsageView(entry.session.getSessionStats(), entry.compactedTokens) : null;
}

export function contextUsageView(
  stats: Pick<ReturnType<AgentSession['getSessionStats']>, 'contextUsage' | 'tokens'>,
  compactedTokens?: number,
): ContextUsageView | null {
  const usage = stats.contextUsage;
  if (!usage) return null;
  const estimate =
    usage.tokens === null && compactedTokens !== undefined && usage.contextWindow > 0
      ? {
          tokens: compactedTokens,
          percent: (compactedTokens / usage.contextWindow) * 100,
          estimated: true,
        }
      : null;
  const { input, cacheRead, cacheWrite } = stats.tokens;
  return {
    tokens: usage.tokens,
    contextWindow: usage.contextWindow,
    percent: usage.percent,
    ...estimate,
    ...(cacheRead + cacheWrite > 0 ? { inputTokens: input, cachedTokens: cacheRead } : {}),
  };
}

function modelView(choice: ModelChoice) {
  if (choice.kind === 'ready')
    return {
      configured: true,
      providerId: choice.selection.provider.id,
      providerName: choice.selection.provider.name,
      model: choice.selection.model,
      modelUnavailable: false,
      effortLevels: choice.effortLevels,
      effort: choice.selection.effort,
    };
  if (choice.kind === 'unavailable')
    return {
      configured: true,
      providerId: choice.providerId,
      providerName: choice.providerName,
      model: choice.model,
      modelUnavailable: true,
      effortLevels: [],
      effort: choice.effort,
    };
  return {
    configured: false,
    providerId: null,
    providerName: null,
    model: '',
    modelUnavailable: false,
    effortLevels: [],
    effort: null,
  };
}

export function snapshot(id: string): WorkspaceChat {
  const entry = live.get(id);
  const meta = row(id);
  let choice: ModelChoice = { kind: 'none' };
  try {
    choice = modelChoice(meta);
  } catch {}
  let cwd: string | null = entry?.cwd ?? null;
  try {
    cwd ??= sessionCwd(meta.project_id, meta.cwd);
  } catch {}
  let permissionMode: WorkspaceChat['permissionMode'] = null;
  try {
    permissionMode = executionMode(meta);
  } catch {}
  return {
    sessionId: id,
    projectId: meta.project_id,
    cwd,
    permissionMode,
    ...modelView(choice),
    contextUsage: usageOf(entry),
    messages: entry
      ? entry.run
        ? projectMessages(
            entry.session.messages,
            liveSteps.get(id),
            true,
            undefined,
            thinkingTimes(entry.session.sessionManager, liveThinking.get(id)),
          )
        : storedMessages(entry.session.sessionManager)
      : readMessages(id),
    running: Boolean(entry?.run),
    activeTool: entry?.run?.tool,
    compacting: entry?.session.isCompacting ?? false,
    queued: queuedTexts(entry?.session.getSteeringMessages() ?? []),
    tasks: runningTasks(id),
    ...(meta.parent_id ? { subagent: { parentId: meta.parent_id, description: meta.title } } : {}),
  };
}

export function publish(id: string) {
  emit(agentContract, 'session-update', { sessionId: id, chat: snapshot(id) });
}
