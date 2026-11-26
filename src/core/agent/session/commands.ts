import { existsSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import type { WorkspaceChat, MainSessionCommand, PermissionMode } from '../../protocol/agent';
import { hostPorts } from '../../ports';
import * as changes from '../changes';
import { forkSessionFile, loadPi, resolveModel } from '../pi';
import { usableLlmProviders } from '../providers';
import { commandOutputDirectory } from '../sandbox/command-output';
import { closeSidechat, sidechatBusy } from '../sidechat';
import { stopSessionTasks } from '../tasks';
import { live, sessionBranch, type Live } from './live';
import { COMPACTION_DETAILS, publish, snapshot } from './projection';
import { disposeLive, ensureLive, sessionOpening, stopArchivedRun } from './run';
import {
  adoptSessionFile,
  archiveProject,
  childSessionIds,
  emptySessionId,
  insertSession,
  modelAutoCompaction,
  modelChoice,
  preloadPi,
  readPermissionMode,
  readySelection,
  removeSession,
  row,
  sessionCwd,
  writePermissionMode,
  storeModel,
  storeProject,
  storeModelAutoCompaction,
  storeLocalCommandReply,
  storeTitle,
  storeVisibility,
} from './store';

const fullAccessRequests = new Map<string, AbortController>();

export async function setSessionPermissionMode(
  id: string,
  mode: PermissionMode,
): Promise<WorkspaceChat> {
  const meta = row(id);
  if (meta.parent_id) throw new Error('请在主会话切换权限');
  if (mode === 'full' && readPermissionMode(id) !== 'full') {
    if (meta.archived || fullAccessRequests.has(id)) throw new Error('当前会话无法申请完全访问');
    idleSessionIds(id);
    const request = new AbortController();
    fullAccessRequests.set(id, request);
    try {
      const approval = await hostPorts().desktop.approve?.({
        kind: 'full',
        session: id,
        signal: request.signal,
      });
      if (!approval?.approved || request.signal.aborted) return snapshot(id);
    } finally {
      fullAccessRequests.delete(id);
    }
  }
  closeSessionExecution(id);
  writePermissionMode(id, mode);
  return snapshot(id);
}

function idleSessionIds(id: string) {
  const ids = [id, ...childSessionIds(id)];
  if (
    sidechatBusy(id) ||
    ids.some((sessionId) => {
      const entry = live.get(sessionId);
      return sessionOpening(sessionId) || entry?.run || entry?.session.isCompacting;
    })
  )
    throw new Error('请等待当前回答完成');
  return ids;
}

function closeSessionExecution(id: string) {
  const ids = idleSessionIds(id);
  fullAccessRequests.get(id)?.abort();
  void closeSidechat(id);
  for (const sessionId of ids) {
    stopSessionTasks(sessionId);
    const entry = live.get(sessionId);
    if (entry) disposeLive(sessionId, entry);
  }
}

export async function newSession(projectId: string | null): Promise<WorkspaceChat> {
  if (projectId !== null) sessionCwd(projectId, null);
  let empty = emptySessionId(projectId);
  if (empty && !live.get(empty) && existsSync(row(empty).file)) {
    await preloadPi();
    empty = emptySessionId(projectId);
  }
  if (empty && !live.get(empty)?.run) return snapshot(empty);
  return snapshot(insertSession(projectId));
}

export async function forkSession(id: string, entryId: string): Promise<WorkspaceChat> {
  const meta = row(id);
  if (!meta.file || !existsSync(meta.file)) throw new Error('会话还没有可分支的记录');
  const file = await forkSessionFile(meta.file, sessionCwd(meta.project_id, meta.cwd), entryId);
  return snapshot(adoptSessionFile(meta, file, '分支：'));
}

export async function sessionExportBranch(id: string) {
  const { file } = row(id);
  if (!file || !existsSync(file)) throw new Error('这个会话还没有可导出的记录');
  const pi = await loadPi();
  const entry = live.get(id);
  if (entry?.run || entry?.session.isCompacting) throw new Error('请等待当前回答或压缩完成');
  return (entry?.session.sessionManager ?? pi.SessionManager.open(file)).getBranch();
}

export function openSession(id: string): WorkspaceChat {
  row(id);
  return snapshot(id);
}

export function updateSessionVisibility(
  id: string,
  patch: { archived?: boolean; pinned?: boolean },
) {
  row(id);
  storeVisibility(id, patch);
  if (patch.archived) {
    for (const sessionId of [id, ...childSessionIds(id)]) stopArchivedSession(sessionId);
  }
}

function stopArchivedSession(id: string) {
  fullAccessRequests.get(id)?.abort();
  stopSessionTasks(id);
  stopArchivedRun(id);
  void closeSidechat(id);
}

export function moveSession(id: string, projectId: string | null) {
  const meta = row(id);
  if (meta.project_id === projectId) return;
  if (projectId !== null) sessionCwd(projectId, null);
  if (meta.parent_id) throw new Error('请移动主会话');
  closeSessionExecution(id);
  storeProject(id, projectId);
  publish(id);
}

export function archiveProjectSessions(projectId: string | null): string[] {
  const ids = archiveProject(projectId);
  for (const id of ids) stopArchivedSession(id);
  return ids;
}

export async function deleteSession(id: string) {
  fullAccessRequests.get(id)?.abort();
  await closeSidechat(id);
  stopSessionTasks(id);
  const entry = live.get(id);
  if (entry) {
    const done = entry.run?.done;
    if (entry.run) entry.run.cancelled = true;
    await entry.session.abort();
    await done;
    disposeLive(id, entry);
  }
  for (const child of childSessionIds(id)) await deleteSession(child);
  const { file } = row(id);
  removeSession(id);
  await changes.deleteTurnChanges(id);
  await rm(commandOutputDirectory(id), { recursive: true, force: true });
  if (file && existsSync(file)) await hostPorts().desktop.trash(file);
}

function compactionError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/Nothing to compact/i.test(message)) return '对话还太短，没有可压缩的内容';
  if (/Already compacted/i.test(message)) return '刚压缩过，还没有新的内容可压缩';
  return `压缩失败：${message}`;
}

const tokenUnits = { k: 3, m: 6, b: 9 };

function formatTokenCount(tokens: number): string {
  for (const [unit, exponent] of Object.entries(tokenUnits).reverse()) {
    const scale = 10 ** exponent;
    if (tokens >= scale) return `${tokens / scale}${unit}`;
  }
  return String(tokens);
}

async function modelAutoCompactionReply(id: string, value: string): Promise<string> {
  const reset = value.toLowerCase() === 'auto';
  let tokens: number | undefined;
  if (value && !reset) {
    const match = /^(\d{1,3}(?:,\d{3})+|\d+)(\.\d+)?([kmb])?$/i.exec(value);
    if (match) {
      const [, whole, fraction, unit] = match;
      const amount = whole!.replaceAll(',', '') + (fraction ?? '');
      const exponent = unit
        ? tokenUnits[unit.toLowerCase() as keyof typeof tokenUnits]
        : Number(amount) < 1_000
          ? 3
          : 0;
      if (!fraction || unit) tokens = Number(`${amount}e${exponent}`);
    }
    if (tokens === undefined || !Number.isSafeInteger(tokens) || tokens < 100_000)
      return `无法解析“${value}”。应为“auto”，或至少 100k tokens（例如 500k、200000，或简写为 200）。`;
  }
  const { selection } = readySelection(row(id));
  const { model } = await resolveModel(selection);
  const providerId = selection.provider.id;
  const modelId = selection.model;
  const defaultWindow = Math.max(
    0,
    model.contextWindow - (await loadPi()).DEFAULT_COMPACTION_SETTINGS.reserveTokens,
  );
  const capped = (window: number) =>
    window > model.contextWindow
      ? `（受模型 ${formatTokenCount(model.contextWindow)} 上限限制）`
      : '';
  if (reset) {
    storeModelAutoCompaction(providerId, modelId, null);
    return `${model.name} 的自动压缩窗口已恢复默认：${formatTokenCount(defaultWindow)} tokens。`;
  }
  if (tokens !== undefined) {
    storeModelAutoCompaction(providerId, modelId, tokens);
    return `${model.name} 的自动压缩窗口已设置为 ${formatTokenCount(tokens)} tokens${capped(tokens)}。`;
  }
  const setting = modelAutoCompaction(providerId, modelId);
  const window = setting ?? defaultWindow;
  return `${model.name} 的自动压缩窗口：${formatTokenCount(window)} tokens（${setting === undefined ? '默认' : '来自设置'}）${capped(window)}\n\n当上下文接近该窗口大小（若模型的最大上下文窗口更小，则以更小者为准）时，自动压缩会对对话进行总结。`;
}

export async function runLocalSessionCommand(
  id: string,
  name: MainSessionCommand | 'autocompact',
  args: string,
) {
  if (row(id).parent_id) throw new Error('子 Agent 的会话只读');
  const entry = live.get(id);
  if (entry?.run || entry?.session.isCompacting) throw new Error('请等待当前运行结束');
  const sentAt = Date.now();
  const input = args ? `/${name} ${args}` : `/${name}`;
  let reply: string;
  try {
    if (name === 'autocompact') reply = await modelAutoCompactionReply(id, args);
    else {
      const previous =
        name === 'compact'
          ? sessionBranch(id).branch.findLast(({ type }) => type === 'compaction')?.id
          : undefined;
      await runSessionCommand(id, name, args);
      if (name === 'compact') {
        const current = sessionBranch(id).branch.findLast(({ type }) => type === 'compaction')?.id;
        reply = current !== previous ? '上下文已压缩。' : '已取消压缩。';
      } else
        reply =
          name === 'name'
            ? `已将对话重命名为「${row(id).title}」。`
            : '已重新加载 Skills、扩展与 AGENTS.md。';
    }
  } catch (error) {
    reply = error instanceof Error ? error.message : String(error);
  }
  return storeLocalCommandReply(id, { input, reply, sentAt, repliedAt: Date.now() });
}

export async function runSessionCommand(
  id: string,
  name: MainSessionCommand,
  args: string,
): Promise<WorkspaceChat> {
  row(id);
  const busy = (entry: Live | undefined) => {
    if (entry?.run) throw new Error('请等待当前回答完成');
    if (entry?.session.isCompacting) throw new Error('正在压缩上下文，请稍候');
  };
  if (name === 'name') {
    const title = args.trim();
    if (!title) throw new Error('用法：/name 新标题');
    storeTitle(id, title);
  } else if (name === 'reload') {
    const entry = live.get(id);
    busy(entry);
    if (entry) disposeLive(id, entry);
    if (modelChoice(row(id)).kind === 'ready') await ensureLive(id);
  } else {
    const entry = await ensureLive(id);
    busy(entry);
    const last = entry.session.sessionManager.getBranch().at(-1);
    if (last?.type === 'custom' && last.customType === COMPACTION_DETAILS)
      throw new Error('刚压缩过，还没有新的内容可压缩');
    try {
      await entry.session.compact(args || undefined);
    } catch (error) {
      if (!/Compaction cancelled/i.test(error instanceof Error ? error.message : '')) {
        throw new Error(compactionError(error));
      }
    } finally {
      if (entry.stale) disposeLive(id, entry);
    }
  }
  publish(id);
  return snapshot(id);
}

export async function setSessionModel(
  id: string,
  providerId: string,
  model: string,
): Promise<WorkspaceChat> {
  row(id);
  const provider = usableLlmProviders().find((item) => item.id === providerId);
  if (!provider) throw new Error('提供商不存在、已停用或缺少 API Key');
  if (!provider.models.includes(model)) throw new Error('模型不在该提供商的模型列表中');
  storeModel(id, providerId, model, null);
  await applySelection(id);
  publish(id);
  return snapshot(id);
}

export async function setSessionEffort(id: string, level: string): Promise<WorkspaceChat> {
  const choice = modelChoice(row(id));
  if (choice.kind !== 'ready') throw new Error('请先为这个会话选择可用的模型');
  if (!choice.effortLevels.includes(level))
    throw new Error('该档位不在这个模型开启的推理强度列表中，请先在设置中勾选');
  const { provider, model } = choice.selection;
  storeModel(id, provider.id, model, level);
  await applySelection(id);
  publish(id);
  return snapshot(id);
}

async function applySelection(id: string) {
  const entry = live.get(id);
  if (!entry) return;
  if (entry.run || entry.session.isCompacting) {
    entry.stale = true;
    return;
  }
  const choice = modelChoice(row(id));
  if (choice.kind !== 'ready') return;
  const { model, thinking } = await resolveModel(choice.selection);
  await entry.session.setModel(model);
  entry.session.setThinkingLevel(thinking);
  entry.providerId = choice.selection.provider.id;
}
