import { expect, it } from 'vitest';
import { commandPrompt, registerCommandDomain } from '../../../src/core/capabilities/commands';

it('系统提示只列出 Skill 未停用的命令域，全部停用时不提 delion', () => {
  for (const name of ['workspace', 'todo'])
    registerCommandDomain({
      name,
      description: `${name} 能力`,
      skill: { name, files: [] },
      commands: {},
    });

  expect(commandPrompt(new Set(['workspace']))).toContain('- todo：todo 能力');
  expect(commandPrompt(new Set(['workspace']))).not.toContain('workspace');
  expect(commandPrompt(new Set(['workspace', 'todo']))).toBeNull();
});
