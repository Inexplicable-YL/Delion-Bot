import type { z } from 'zod';

export interface Command {
  description: string;
  schema: z.ZodType;
  execute(input: unknown): unknown;
}

export interface BuiltinSkill {
  name: string;
  files: { path: string; content: string }[];
}

export interface CommandDomain {
  name: string;
  description: string;
  skill?: BuiltinSkill;
  commands: Record<string, Command>;
}

const domains: CommandDomain[] = [];

export function registerCommandDomain(domain: CommandDomain): void {
  domains.push(domain);
}

export function enabledCommandDomains(disabledSkills: ReadonlySet<string>): CommandDomain[] {
  return domains.filter((domain) => !domain.skill || !disabledSkills.has(domain.skill.name));
}

export function commandPrompt(disabledSkills: ReadonlySet<string>): string | null {
  const enabled = enabledCommandDomains(disabledSkills);
  if (enabled.length === 0) return null;
  return [
    '## Local Delion commands',
    "Run `delion help` in bash to check available commands and arguments before using `delion <command> '<JSON>'`. Consult the relevant skill for detailed instructions.",
    ...enabled.map((domain) => `- ${domain.name}: ${domain.description}`),
  ].join('\n');
}

export function builtinSkills(): BuiltinSkill[] {
  return domains.flatMap((domain) => (domain.skill ? [domain.skill] : []));
}
