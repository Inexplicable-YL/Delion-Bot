import { existsSync, mkdirSync, readdirSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { z } from 'zod';
import type { SkillOrigin, SkillView } from '../protocol/capabilities';
import { discoverProjectSkills } from './discovery';
import { documentReader, readyDocumentReader } from './documents';
import { hostPorts } from '../ports';
import { builtinSkills } from './commands';

const SKILL_ENTRY_FILE = 'SKILL.md';

export function builtinSkillsDirectory(): string {
  return join(hostPorts().paths.home(), '.delion-bot', 'skills');
}

export function globalSkillDirectories(): string[] {
  return [builtinSkillsDirectory(), join(hostPorts().paths.home(), '.agents', 'skills')];
}

let builtinEnsured = false;
export function ensureBuiltinSkills(): void {
  if (builtinEnsured) return;
  builtinEnsured = true;
  rmSync(join(builtinSkillsDirectory(), 'mail', SKILL_ENTRY_FILE), { force: true });
  for (const skill of builtinSkills())
    for (const file of skill.files) {
      const path = join(builtinSkillsDirectory(), skill.name, file.path);
      if (existsSync(path) && readFileSync(path, 'utf8') === file.content) continue;
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, file.content, 'utf8');
    }
}

function description(path: string): string {
  const match = /^description:\s*(.*)$/m.exec(readFileSync(path, 'utf8'));
  return match?.[1]?.trim() ?? '';
}

export function readDisabledSkills(): Set<string> {
  const row = hostPorts()
    .database()
    .prepare("SELECT value FROM workspace_settings WHERE key='skills-disabled'")
    .get() as { value: string } | undefined;
  const parsed = z.array(z.string()).safeParse(row ? JSON.parse(row.value) : []);
  return new Set(parsed.success ? parsed.data : []);
}

export function effectiveDisabledSkills(): Set<string> {
  const disabled = readDisabledSkills();
  const reader = documentReader();
  if (reader && reader.dependency().status !== 'ready') disabled.add(reader.skill);
  return disabled;
}

const DISABLED_PATHS_KEY = 'skills-disabled-paths';

export function readDisabledSkillPaths(): Set<string> {
  try {
    const row = hostPorts()
      .database()
      .prepare('SELECT value FROM workspace_settings WHERE key=?')
      .get(DISABLED_PATHS_KEY) as { value: string } | undefined;
    const paths = z.array(z.string()).parse(JSON.parse(row?.value ?? '[]'));
    return new Set(paths.map((path) => resolve(path)));
  } catch {
    return new Set();
  }
}

function globalSkills(): SkillView[] {
  const disabled = readDisabledSkills();
  const skills: SkillView[] = [];
  const seen = new Set<string>();
  const builtin = new Set(builtinSkills().map((skill) => skill.name));
  const reader = documentReader();
  for (const directory of globalSkillDirectories()) {
    if (!existsSync(directory)) continue;
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name, SKILL_ENTRY_FILE);
      if (!entry.isDirectory() || seen.has(entry.name) || !existsSync(path)) continue;
      seen.add(entry.name);
      const origin: SkillOrigin =
        directory === builtinSkillsDirectory() && builtin.has(entry.name) ? 'builtin' : 'user';
      skills.push({
        id: path,
        name: entry.name,
        description: description(path),
        enabled:
          !disabled.has(entry.name) &&
          (entry.name !== reader?.skill || reader.dependency().status === 'ready'),
        path,
        origin,
        dependency: entry.name === reader?.skill ? reader.dependency() : undefined,
      });
    }
  }
  return skills;
}

async function projectSkills(disabledPaths: Set<string>): Promise<SkillView[]> {
  const projects = hostPorts().projects.local();
  const lists = await Promise.all(
    projects
      .filter((project) => existsSync(project.path))
      .map(async (project) =>
        (await discoverProjectSkills(project.path)).map((skill) => ({
          id: skill.path,
          name: skill.name,
          description: skill.description,
          path: skill.path,
          origin: 'project' as const,
          group: { id: project.id, label: project.name },
          enabled: !disabledPaths.has(skill.path),
        })),
      ),
  );
  return lists.flat();
}

export async function listSkills(): Promise<SkillView[]> {
  ensureBuiltinSkills();
  return [...globalSkills(), ...(await projectSkills(readDisabledSkillPaths()))];
}

export async function setGlobalSkillEnabled(name: string, enabled: boolean): Promise<void> {
  if (name === documentReader()?.skill && enabled) await readyDocumentReader().verify();
  const disabled = readDisabledSkills();
  if (enabled) disabled.delete(name);
  else disabled.add(name);
  hostPorts()
    .database()
    .prepare("INSERT OR REPLACE INTO workspace_settings VALUES ('skills-disabled', ?)")
    .run(JSON.stringify([...disabled]));
}

export async function setSkillEnabled(id: string, enabled: boolean): Promise<SkillView[]> {
  const skill = await findSkill(id);
  if (skill.origin === 'project') {
    const disabled = readDisabledSkillPaths();
    if (enabled) disabled.delete(skill.path);
    else disabled.add(skill.path);
    hostPorts()
      .database()
      .prepare('INSERT OR REPLACE INTO workspace_settings VALUES (?, ?)')
      .run(DISABLED_PATHS_KEY, JSON.stringify([...disabled]));
  } else await setGlobalSkillEnabled(skill.name, enabled);
  return listSkills();
}

export async function findSkill(id: string): Promise<SkillView> {
  const skill = (await listSkills()).find((item) => item.id === id);
  if (!skill) throw new Error('Skill 不存在或已被移除');
  return skill;
}

export async function readSkill(id: string): Promise<string> {
  return readFileSync((await findSkill(id)).path, 'utf8');
}

export async function revealSkill(id: string): Promise<void> {
  hostPorts().desktop.reveal((await findSkill(id)).path);
}

export function skillDirectory(skill: SkillView): string {
  return dirname(skill.path);
}
