import { constants, realpathSync, statSync } from 'node:fs';
import { open } from 'node:fs/promises';
import { isAbsolute, posix, relative, resolve, sep } from 'node:path';
import type { Skill, SkillFrontmatter, ToolDefinition } from '@earendil-works/pi-coding-agent';
import { discoverProjectSkills } from '../../capabilities/discovery';
import { listGlobalSkills, readDisabledSkillPaths } from '../../capabilities/skills';
import { loadPi } from '../pi';
import type { ScopedDirectory } from './mode';
import { inspectCommandPath } from './scoped-files';

const maxSkillBytes = 200_000;

async function localProjectSkills(project: ScopedDirectory, cancellation?: AbortSignal) {
  const skills = new Map<string, Skill>();
  const { createSyntheticSourceInfo } = await loadPi();
  const disabled = readDisabledSkillPaths();
  for (const discovered of await discoverProjectSkills(project.host)) {
    if (cancellation?.aborted) break;
    let file: string;
    let size: ReturnType<typeof statSync>;
    try {
      file = realpathSync.native(discovered.path);
      size = statSync(file);
    } catch {
      continue;
    }
    const key = relative(project.host, file);
    if (
      !key ||
      key === '..' ||
      key.startsWith(`..${sep}`) ||
      isAbsolute(key) ||
      disabled.has(resolve(file)) ||
      !size.isFile() ||
      size.size > maxSkillBytes ||
      skills.has(discovered.name)
    )
      continue;
    const virtual = `/project/${key.replaceAll('\\', '/')}`;
    skills.set(discovered.name, {
      name: discovered.name,
      description: discovered.description.trim().slice(0, 1024),
      filePath: virtual,
      baseDir: posix.dirname(virtual),
      sourceInfo: createSyntheticSourceInfo(virtual, { source: 'project', scope: 'project' }),
      disableModelInvocation: discovered.disableModelInvocation,
    });
  }
  return skills;
}

export async function scopedProjectSkills(project: ScopedDirectory, cancellation?: AbortSignal) {
  if (!project.remote) return localProjectSkills(project, cancellation);
  const timeout = AbortSignal.timeout(10_000);
  const signal = cancellation ? AbortSignal.any([cancellation, timeout]) : timeout;
  const { entries } = await inspectCommandPath(
    [project],
    '/project/.agents/skills',
    { action: 'find', pattern: 'SKILL.md', filesOnly: true, skipHidden: true },
    signal,
  );
  const skills = new Map<string, Skill>();
  if (!entries?.length) return skills;
  const { parseFrontmatter, createSyntheticSourceInfo } = await loadPi();
  for (const key of entries) {
    if (signal.aborted) break;
    const filePath = `/project/${key}`;
    let frontmatter: SkillFrontmatter;
    try {
      const { data } = await inspectCommandPath(
        [project],
        filePath,
        { action: 'read', limit: maxSkillBytes },
        signal,
      );
      if (!data) continue;
      ({ frontmatter } = parseFrontmatter<SkillFrontmatter>(
        Buffer.from(data, 'base64').toString('utf8'),
      ));
    } catch {
      continue;
    }
    const { name, description } = frontmatter;
    if (
      typeof name !== 'string' ||
      !name.trim() ||
      typeof description !== 'string' ||
      !description.trim()
    )
      continue;
    if (!skills.has(name))
      skills.set(name, {
        name,
        description: description.trim().slice(0, 1024),
        filePath,
        baseDir: posix.dirname(filePath),
        sourceInfo: createSyntheticSourceInfo(filePath, { source: 'project', scope: 'project' }),
        disableModelInvocation: frontmatter['disable-model-invocation'] === true,
      });
  }
  return skills;
}

export function scopedSkillTool(
  project?: ScopedDirectory,
  projectSkills?: Awaited<ReturnType<typeof scopedProjectSkills>>,
): ToolDefinition {
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
        const catalog =
          projectSkills ?? (project ? await scopedProjectSkills(project, signal) : undefined);
        const projectSkill = name ? catalog?.get(name) : undefined;
        if (project && projectSkill) {
          if (
            !project.remote &&
            readDisabledSkillPaths().has(
              resolve(project.host, projectSkill.filePath.slice('/project/'.length)),
            )
          )
            return text('The skill does not exist or is disabled.', true);
          const result = await inspectCommandPath(
            [project],
            projectSkill.filePath,
            { action: 'read', limit: maxSkillBytes },
            signal ?? AbortSignal.timeout(10_000),
          );
          if (result.error) return text(result.error, true);
          return text(Buffer.from(result.data ?? '', 'base64').toString('utf8'));
        }
        const skills = listGlobalSkills().filter((skill) => skill.enabled);
        if (!name)
          return text(
            JSON.stringify(
              [
                ...[...(catalog?.values() ?? [])].filter((skill) => !skill.disableModelInvocation),
                ...skills.filter((skill) => !catalog?.has(skill.name)),
              ].map(({ name, description }) => ({ name, description })),
            ),
          );
        const skill = skills.find((skill) => skill.name === name);
        if (!skill) return text('The skill does not exist or is disabled.', true);
        const file = await open(skill.path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
        try {
          const info = await file.stat();
          if (!info.isFile() || info.size > maxSkillBytes)
            return text('Unable to read the skill instructions.', true);
          const bytes = Buffer.alloc(info.size + 1);
          const { bytesRead } = await file.read(bytes);
          if (bytesRead > info.size) return text('The skill instructions changed.', true);
          return text(bytes.subarray(0, bytesRead).toString('utf8'));
        } finally {
          await file.close();
        }
      } catch {
        return text('Unable to read the skill instructions.', true);
      }
    },
  };
}
