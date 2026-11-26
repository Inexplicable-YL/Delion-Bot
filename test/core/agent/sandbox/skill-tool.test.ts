import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, expect, it, vi } from 'vitest';
import { provideTestHostPorts } from '../../host-mock';

const state = vi.hoisted(() => ({
  scopedFile: vi.fn(),
  disabled: new Set<string>(),
}));

vi.mock('electron', () => ({ app: { getPath: () => '/tmp/delion-skill-tool' } }));
vi.mock('../../../../src/core/capabilities/skills', () => ({
  listGlobalSkills: () => [],
  readDisabledSkillPaths: () => state.disabled,
}));
vi.mock('../../../../src/core/remote/helper', async (original) => ({
  ...(await original<typeof import('../../../../src/core/remote/helper')>()),
  helperSession: () => ({ scopedFile: state.scopedFile }),
}));

import {
  scopedProjectSkills,
  scopedSkillTool,
} from '../../../../src/core/agent/sandbox/skill-tool';

const root = realpathSync(mkdtempSync(join(tmpdir(), 'delion-skill-tool-')));
provideTestHostPorts({
  paths: { userData: () => join(root, 'user'), home: () => join(root, 'home') },
});
afterAll(() => rmSync(root, { recursive: true, force: true }));

function writeSkill(directory: string, name: string, description: string, extra = '') {
  const target = join(root, 'project', '.agents', 'skills', directory);
  mkdirSync(target, { recursive: true });
  const path = join(target, 'SKILL.md');
  writeFileSync(
    path,
    `---\nname: ${name}\ndescription: ${description}\n${extra}---\nInstructions for ${name}.\n`,
  );
  return path;
}

it('discovers remote project skills through the helper sandbox', async () => {
  const found = '.agents/skills/alpha/SKILL.md';
  state.scopedFile.mockImplementation(async (_directory, request) => {
    if (request.action === 'find') return { entries: [found, '.agents/skills/beta/SKILL.md'] };
    if (request.path === found)
      return {
        data: Buffer.from(
          '---\nname: alpha\ndescription: Remote alpha\n---\nRemote instructions.\n',
        ).toString('base64'),
      };
    return { data: Buffer.from('---\nname: beta\n---\nMissing description.\n').toString('base64') };
  });
  const skills = await scopedProjectSkills({
    name: '/project',
    host: '/srv/project',
    remote: { host: 'example.com' },
  });
  expect([...skills.keys()]).toEqual(['alpha']);
  expect(skills.get('alpha')).toMatchObject({
    filePath: `/project/${found}`,
    description: 'Remote alpha',
  });
  expect(state.scopedFile).toHaveBeenCalledWith(
    '/srv/project',
    expect.objectContaining({ action: 'find', path: '.agents/skills' }),
    expect.any(AbortSignal),
  );
});

it('discovers local project skills with Pi rules and skips disabled, duplicate, and oversized entries', async () => {
  writeSkill('alpha', 'alpha', 'Local alpha');
  writeSkill('alpha-copy', 'alpha', 'Duplicate alpha');
  const disabled = writeSkill('disabled', 'disabled', 'Disabled skill');
  writeSkill('hidden', 'hidden', 'Hidden workflow', 'disable-model-invocation: true\n');
  writeSkill('oversized', 'oversized', 'Oversized skill', `padding: ${'x'.repeat(210_000)}\n`);
  state.disabled = new Set([resolve(disabled)]);
  const skills = await scopedProjectSkills({
    name: '/project',
    host: join(root, 'project'),
  });
  expect([...skills.keys()].sort()).toEqual(['alpha', 'hidden']);
  expect(skills.get('hidden')).toMatchObject({
    filePath: '/project/.agents/skills/hidden/SKILL.md',
    disableModelInvocation: true,
  });
});

it('refuses a project skill disabled after the catalog was built', async () => {
  const path = writeSkill('guarded', 'guarded', 'Guarded workflow');
  const project = { name: '/project' as const, host: join(root, 'project') };
  const catalog = await scopedProjectSkills(project);
  state.disabled = new Set([resolve(path)]);
  const result = await scopedSkillTool(project, catalog).execute(
    'call',
    { name: 'guarded' },
    undefined,
    undefined,
    {} as never,
  );
  expect(result).toMatchObject({
    isError: true,
    content: [{ text: 'The skill does not exist or is disabled.' }],
  });
});
