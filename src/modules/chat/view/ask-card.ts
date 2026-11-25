import { z } from 'zod';
import type { AgentToolResult, WorkspaceChat } from '../../../core/protocol/agent';

const askGroups = z
  .object({
    questions: z
      .array(
        z.object({
          question: z.string().trim().min(1),
          multiple: z.boolean().optional(),
          options: z
            .array(
              z.object({ label: z.string().trim().min(1), description: z.string().optional() }),
            )
            .min(1),
        }),
      )
      .min(1),
  })
  .transform(({ questions }) => questions);

export type AskGroup = z.output<typeof askGroups>[number];

export const ASK_USER_TOOL = 'ask_user';

export function pendingAsk(
  messages: WorkspaceChat['messages'],
): { id: string; groups: AskGroup[] } | null {
  const last = messages.at(-1);
  const part = last?.role === 'assistant' ? last.parts?.at(-1) : undefined;
  const call: AgentToolResult | undefined =
    part?.type === 'tools' ? part.results.at(-1) : undefined;
  if (call?.name !== ASK_USER_TOOL || !call.output || call.output.isError) return null;
  const parsed = askGroups.safeParse(call.input);
  return parsed.success ? { id: call.id, groups: parsed.data } : null;
}

const skippedAnswer = '（跳过）';

const questionLine = (question: string) => question.replace(/\s+/g, ' ').replace(/[:：]$/, '');

export function formatAskAnswer(groups: AskGroup[], answers: string[][]): string {
  return groups
    .map((group, index) => {
      const picked = answers[index] ?? [];
      return `${questionLine(group.question)}：${picked.length ? picked.join('、') : skippedAnswer}`;
    })
    .join('\n');
}
