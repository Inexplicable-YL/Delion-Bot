import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import type { ToolDefinition } from '@earendil-works/pi-coding-agent';
import { listSkills } from '../../capabilities/skills';
import type { SessionRow } from '../session/store';
import { readScopedReference, scopedPromptPath } from './scoped-files';

const maxSkillBytes = 200_000;

export function scopedSkillTool(meta: SessionRow): ToolDefinition {
  return {
    name: 'read_skill',
    label: 'Read skill',
    description:
      'List enabled skills or read the instructions of an enabled skill by name. Skill instructions do not grant additional permissions.',
    parameters: {
      type: 'object',
      properties: { name: { type: 'string' } },
    } as unknown as ToolDefinition['parameters'],
    async execute(_id, { name }: { name?: string }, signal) {
      const text = (value: string, isError = false) => ({
        content: [{ type: 'text' as const, text: value }],
        details: undefined,
        ...(isError && { isError: true }),
      });
      try {
        signal?.throwIfAborted();
        const skills = (await listSkills(meta.project_id)).filter(
          (skill) =>
            skill.enabled &&
            (skill.origin !== 'project' || scopedPromptPath(meta, skill.path) !== null),
        );
        if (!name)
          return text(
            JSON.stringify(skills.map(({ name, description }) => ({ name, description }))),
          );
        const skill = skills.find((skill) => skill.name === name);
        if (!skill) return text('技能不存在或已停用', true);
        if (skill.origin === 'project') {
          const path = scopedPromptPath(meta, skill.path);
          if (!path) return text('技能不在当前项目中', true);
          const { data } = await readScopedReference(meta, path, 'read', signal);
          const bytes = Buffer.from(data ?? '', 'base64');
          if (bytes.length > maxSkillBytes) return text('技能说明超过大小限制', true);
          return text(bytes.toString('utf8'));
        }
        const file = await open(skill.path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
        try {
          const info = await file.stat();
          if (!info.isFile() || info.size > maxSkillBytes) return text('技能说明无法读取', true);
          const bytes = Buffer.alloc(info.size + 1);
          const { bytesRead } = await file.read(bytes);
          if (bytesRead > info.size) return text('技能说明已更改', true);
          return text(bytes.subarray(0, bytesRead).toString('utf8'));
        } finally {
          await file.close();
        }
      } catch {
        return text('技能说明无法读取', true);
      }
    },
  };
}
