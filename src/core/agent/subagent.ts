import type { AgentSessionEvent, ToolDefinition } from '@earendil-works/pi-coding-agent';
import { z } from 'zod';
import type { TaskStatus, SubagentDetails } from '../protocol/agent';
import { hostPorts } from '../ports';
import { sessionRunning } from './session/live';
import { insertSubagentSession, row } from './session/store';
import { taskRunning, trackTask, type TaskParent } from './tasks';

const LIMIT_KEY = 'subagent-limit';
const SUBAGENT_LIMIT = { min: 1, max: 16, default: 4 };
const limitSchema = z.number().int().min(SUBAGENT_LIMIT.min).max(SUBAGENT_LIMIT.max);

export function readSubagentLimit(): number {
  const found = hostPorts()
    .database()
    .prepare('SELECT value FROM workspace_settings WHERE key=?')
    .get(LIMIT_KEY) as { value: string } | undefined;
  const parsed = limitSchema.safeParse(found ? Number(found.value) : undefined);
  return parsed.success ? parsed.data : SUBAGENT_LIMIT.default;
}

export function setSubagentLimit(value: unknown): number {
  const limit = limitSchema.parse(value);
  hostPorts()
    .database()
    .prepare('INSERT OR REPLACE INTO workspace_settings VALUES (?, ?)')
    .run(LIMIT_KEY, String(limit));
  return limit;
}

export interface SubagentResult {
  status: Exclude<TaskStatus, 'running'>;
  reply: string | null;
  error?: string;
}

export type RunSubagent = (
  id: string,
  prompt: string,
  signal: AbortSignal | undefined,
  onEvent: (event: AgentSessionEvent) => void,
) => Promise<SubagentResult>;

let running = 0;

function targetOf(args: unknown): string {
  const input = (args ?? {}) as Record<string, unknown>;
  const value = ['command', 'path', 'pattern', 'query', 'url']
    .map((key) => input[key])
    .find((item): item is string => typeof item === 'string');
  return value?.split('\n')[0] ?? '';
}

const DESCRIPTION = `Delegate an independent task to a subagent and return its final reply.
The subagent shares your working directory and tools, except that it cannot delegate. It cannot see your conversation history. Give it the background, goal, expected result, and files it may edit. Assign distinct files to parallel subagents to avoid overwriting their changes.
Multiple task calls in one reply run in parallel. Reuse the returned taskId to follow up with the same subagent and retain its conversation history.
Set background to true to return taskId immediately. Completion delivers the final reply automatically. Use task_output to inspect progress or task_stop to stop the task.
To summarize or analyze another session, ask a subagent to read it with session_read and report back. This keeps the full transcript out of your context.`;

export function taskTool(
  parent: TaskParent,
  cwd: string,
  runSubagent: RunSubagent,
): ToolDefinition {
  return {
    name: 'task',
    label: 'task',
    description: DESCRIPTION,
    parameters: {
      type: 'object',
      properties: {
        description: { type: 'string', description: 'Short task name shown to the user.' },
        prompt: { type: 'string', description: 'Complete instructions for the subagent.' },
        taskId: { type: 'string', description: 'Resume this subagent. Omit to create a new one.' },
        background: {
          type: 'boolean',
          description: 'Set to true to return immediately and run in the background.',
        },
      },
      required: ['description', 'prompt'],
    } as unknown as ToolDefinition['parameters'],
    async execute(
      _id,
      params: { description: string; prompt: string; taskId?: string; background?: boolean },
      signal,
      onUpdate,
    ) {
      const limit = readSubagentLimit();
      if (running >= limit)
        throw new Error(
          `同时运行的子 Agent 已达上限（${limit} 个）：等已有的结束后再派，或请用户在设置 › 内置能力里调高上限`,
        );
      if (params.taskId) {
        let owner: string | null = null;
        try {
          owner = row(params.taskId).parent_id;
        } catch {}
        if (owner !== parent.id) throw new Error(`没有这个子 Agent：${params.taskId}`);
        if (taskRunning(params.taskId) || sessionRunning(params.taskId))
          throw new Error('这个子 Agent 还在运行，等它结束再续接');
      }
      const taskId = params.taskId ?? insertSubagentSession(parent.id, params.description, cwd);
      running += 1;
      if (params.background) {
        const abort = new AbortController();
        trackTask(
          {
            id: taskId,
            parent,
            kind: 'subagent',
            label: params.description,
            stop: () => abort.abort(),
          },
          runSubagent(taskId, params.prompt, abort.signal, () => {}).finally(() => (running -= 1)),
        );
        return {
          content: [
            {
              type: 'text',
              text: `taskId: ${taskId}\n\n已在后台运行。结束时会自动通知你，不需要轮询。`,
            },
          ],
          details: {
            taskId,
            status: 'running',
            steps: 0,
            background: true,
          } satisfies SubagentDetails,
        };
      }
      const details: SubagentDetails = { taskId, status: 'running', steps: 0 };
      const update = () => onUpdate?.({ content: [], details: { ...details } });
      try {
        update();
        const result = await runSubagent(taskId, params.prompt, signal, (event) => {
          if (event.type === 'tool_execution_start') {
            details.steps += 1;
            details.tool = { name: event.toolName, target: targetOf(event.args) };
            update();
          } else if (event.type === 'tool_execution_end') {
            delete details.tool;
            update();
          }
        });
        const final: SubagentDetails = {
          taskId,
          status: result.status,
          steps: details.steps,
          reply: result.reply,
        };
        const text =
          result.status === 'completed'
            ? (result.reply ?? '（子 Agent 没有给出最终回复）')
            : result.status === 'stopped'
              ? `子 Agent 已停止。${result.reply ? `停止前最后的回复：\n${result.reply}` : ''}`
              : `子 Agent 执行失败：${result.error ?? '未知错误'}`;
        return {
          content: [{ type: 'text', text: `taskId: ${taskId}\n\n${text}` }],
          details: final,
          ...(result.status === 'completed' ? {} : { isError: true }),
        };
      } finally {
        running -= 1;
      }
    },
  };
}
