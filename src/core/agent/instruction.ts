import { z } from 'zod';
import { hostPorts } from '../ports';

const instructionSchema = z.string().trim().max(2000);
const projectContextSchema = z.object({
  instruction: instructionSchema,
  files: z.array(z.string()).max(100),
});

export function getAgentInstruction(): string {
  const row = hostPorts()
    .database()
    .prepare("SELECT value FROM workspace_settings WHERE key='agent-instruction'")
    .get() as { value: string } | undefined;
  return instructionSchema.catch('').parse(row?.value ?? '');
}

export function setAgentInstruction(input: unknown): string {
  const text = instructionSchema.parse(input);
  hostPorts()
    .database()
    .prepare("INSERT OR REPLACE INTO workspace_settings VALUES ('agent-instruction', ?)")
    .run(text);
  return text;
}

export function getProjectChatContext(projectId: string) {
  const row = hostPorts()
    .database()
    .prepare('SELECT value FROM workspace_settings WHERE key=?')
    .get(`project-chat:${projectId}`) as { value: string } | undefined;
  return row ? projectContextSchema.parse(JSON.parse(row.value)) : { instruction: '', files: [] };
}

export function setProjectChatContext(
  projectId: string,
  patch: Partial<z.infer<typeof projectContextSchema>>,
) {
  const next = projectContextSchema.parse({ ...getProjectChatContext(projectId), ...patch });
  hostPorts()
    .database()
    .prepare('INSERT OR REPLACE INTO workspace_settings VALUES (?, ?)')
    .run(`project-chat:${projectId}`, JSON.stringify(next));
  return next;
}
