import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { hostPorts } from '../ports';
import { helperSession } from './helper';
import { remoteBackend, setContextMirrors, writeRemoteFile } from './operations';
import { shellQuote, type RemoteTarget } from './transport';
import { CONTEXT_FILE_NAMES } from '../capabilities/context-files';

const REPO_SKILL_DIR = '.agents/skills';
const HOME_SKILL_DIR = '.delion-bot/skills';

const MIRROR_FILE_LIMIT = '1048576c';
const SYNC_TIMEOUT_SECONDS = 30;

const HOME_MARK = '@@HOME';
const SKILLS_MARK = '@@SKILLS';
const AGENTS_MARK = '@@AGENTS';
const END_MARK = '@@END';

interface Record {
  path: string;
  content: Buffer;
}

function mirrorScript(home: string, remoteDir: string, ancestors: string[]): string {
  const sections: string[] = [`printf '${HOME_MARK}\\0%s\\0' "$HOME"`];

  const skillSections: { label: string; dir: string }[] = [
    { label: `repo:${REPO_SKILL_DIR}`, dir: `${remoteDir}/${REPO_SKILL_DIR}` },
    { label: `home:${HOME_SKILL_DIR}`, dir: `${home}/${HOME_SKILL_DIR}` },
  ];
  for (const { label, dir } of skillSections) {
    sections.push(
      `printf '${SKILLS_MARK}\\0%s\\0' ${shellQuote(label)}`,
      `if [ -d ${shellQuote(dir)} ]; then (cd ${shellQuote(dir)} && find . -type f -size -${MIRROR_FILE_LIMIT} -not -path './.git/*' | LC_ALL=C sort | while IFS= read -r f; do printf '%s\\0' "$f"; base64 < "$f" | tr -d '\\n'; printf '\\0'; done); fi`,
      `printf '${END_MARK}\\0'`,
    );
  }

  sections.push(`printf '${AGENTS_MARK}\\0'`);
  const names = CONTEXT_FILE_NAMES.map((name) => shellQuote(name)).join(' ');
  for (const dir of ancestors) {
    sections.push(
      `_p=""; for _f in ${names}; do if [ -f ${shellQuote(dir)}/"$_f" ]; then _p=${shellQuote(dir)}/"$_f"; break; fi; done`,
      `if [ -n "$_p" ]; then printf '%s\\0' "$_p"; base64 < "$_p" | tr -d '\\n'; printf '\\0'; fi`,
    );
  }
  return sections.join('\n');
}

function ancestorsOf(remoteDir: string): string[] {
  const parts = remoteDir.split('/').filter(Boolean);
  const dirs = ['/'];
  let current = '';
  for (const part of parts) {
    current += `/${part}`;
    dirs.push(current);
  }
  return dirs;
}

function parseRecords(stdout: Buffer): {
  home: string | null;
  skills: Map<string, Record[]>;
  agentsFiles: { path: string; content: string }[];
} {
  const tokens = stdout.toString('utf8').split('\0');
  const skills = new Map<string, Record[]>();
  const agentsFiles: { path: string; content: string }[] = [];
  let home: string | null = null;
  let index = 0;
  while (index < tokens.length) {
    const token = tokens[index]!;
    index += 1;
    if (token === HOME_MARK) {
      home = tokens[index] ?? null;
      index += 1;
    } else if (token === SKILLS_MARK) {
      const label = tokens[index] ?? '';
      index += 1;
      const records: Record[] = [];
      while (index + 1 < tokens.length && !tokens[index]!.startsWith('@@')) {
        records.push({ path: tokens[index]!, content: Buffer.from(tokens[index + 1]!, 'base64') });
        index += 2;
      }
      skills.set(label, records);
    } else if (token === AGENTS_MARK) {
      while (index + 1 < tokens.length && !tokens[index]!.startsWith('@@')) {
        agentsFiles.push({
          path: tokens[index]!,
          content: Buffer.from(tokens[index + 1]!, 'base64')
            .toString('utf8')
            .replace(/^\uFEFF/, ''),
        });
        index += 2;
      }
    }
  }
  return { home, skills, agentsFiles };
}

export function contextMirrorRoot(remoteId: string, projectId: string): string {
  const safe = projectId.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 100);
  return join(hostPorts().paths.userData(), 'remote-context', remoteId, safe);
}

function writeMirror(dir: string, records: Record[]): string | null {
  rmSync(dir, { recursive: true, force: true });
  if (records.length === 0) return null;
  for (const record of records) {
    const target = join(dir, record.path.replace(/^\.\//, ''));
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, record.content);
  }
  return dir;
}

export interface RemoteContext {
  skillPaths: string[];
  agentsFiles: { path: string; content: string }[];
}

export async function syncRemoteContext(input: {
  target: RemoteTarget;
  key: string;
  remoteId: string;
  projectId: string;
  remoteDir: string;
  home?: string | null;
}): Promise<RemoteContext> {
  const mirrorRoot = contextMirrorRoot(input.remoteId, input.projectId);
  const empty: RemoteContext = { skillPaths: [], agentsFiles: [] };
  try {
    const { exec } = remoteBackend(input.target).bash;
    const script = mirrorScript(
      input.home ?? '$HOME',
      input.remoteDir,
      ancestorsOf(input.remoteDir),
    );
    const chunks: Buffer[] = [];
    const result = await exec(script, '/', {
      onData: (chunk) => chunks.push(chunk),
      timeout: SYNC_TIMEOUT_SECONDS,
    });
    if (result.exitCode !== 0)
      throw new Error(
        `镜像脚本退出码 ${String(result.exitCode)}：${Buffer.concat(chunks).toString('utf8').slice(0, 200)}`,
      );
    const { home, skills, agentsFiles } = parseRecords(Buffer.concat(chunks));
    const homeDir = input.home ?? home;
    if (!homeDir?.startsWith('/')) throw new Error('未能确定远端主目录');

    const skillPaths: string[] = [];
    const repoSkills = writeMirror(
      join(mirrorRoot, 'repo', REPO_SKILL_DIR),
      skills.get(`repo:${REPO_SKILL_DIR}`) ?? [],
    );
    if (repoSkills) skillPaths.push(repoSkills);
    const homeSkills = writeMirror(
      join(mirrorRoot, 'home', HOME_SKILL_DIR),
      skills.get(`home:${HOME_SKILL_DIR}`) ?? [],
    );
    if (homeSkills) skillPaths.push(homeSkills);

    setContextMirrors(input.key, [
      { mirror: join(mirrorRoot, 'repo'), remote: input.remoteDir },
      { mirror: join(mirrorRoot, 'home'), remote: homeDir },
    ]);
    return { skillPaths, agentsFiles };
  } catch (error) {
    console.warn('[remotes] 远端上下文镜像失败，本次会话不带远端 skills/AGENTS.md', error);
    setContextMirrors(input.key, []);
    return empty;
  }
}

function skillFiles(dir: string): string[] {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => relative(dir, join(entry.parentPath, entry.name)));
}

export async function uploadSkillToRemote(input: {
  target: RemoteTarget;
  skillDir: string;
  name: string;
  remoteDir: string;
  overwrite: boolean;
}): Promise<{ path: string; files: number }> {
  const destination = `${input.remoteDir}/${REPO_SKILL_DIR}/${input.name}`;
  if (!input.overwrite && (await helperSession(input.target).stat([destination]))[0]?.exists)
    throw new Error(`远端已存在：${destination}`);

  const files = skillFiles(input.skillDir);
  for (const file of files) {
    await writeRemoteFile(
      input.target,
      `${destination}/${file.replace(/\\/g, '/')}`,
      readFileSync(join(input.skillDir, file)),
    );
  }
  return { path: destination, files: files.length };
}
