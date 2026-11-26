import { resolve } from 'node:path';
import { isPiProjectSkill, loadPi, piAgentDir } from '../agent/pi';

export interface DiscoveredSkill {
  name: string;
  description: string;
  path: string;
  disableModelInvocation: boolean;
}

export async function discoverProjectSkills(cwd: string): Promise<DiscoveredSkill[]> {
  const pi = await loadPi();
  const loader = new pi.DefaultResourceLoader({
    cwd,
    agentDir: piAgentDir(),
    settingsManager: pi.SettingsManager.inMemory({}),
    noExtensions: true,
    noPromptTemplates: true,
    noThemes: true,
    noContextFiles: true,
  });
  await loader.reload();
  return loader
    .getSkills()
    .skills.filter(
      (skill) => skill.sourceInfo.scope === 'project' && !isPiProjectSkill(skill.filePath, cwd),
    )
    .map((skill) => ({
      name: skill.name,
      description: skill.description,
      path: resolve(skill.filePath),
      disableModelInvocation: skill.disableModelInvocation,
    }));
}
