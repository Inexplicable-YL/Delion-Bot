import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { hostPorts } from '../ports';

export const CONTEXT_FILE_NAMES = [
  'AGENTS.override.md',
  'AGENTS.md',
  'AGENTS.MD',
  'CLAUDE.md',
  'CLAUDE.MD',
];

export function globalContextFiles(): { path: string; content: string }[] {
  const directory = join(hostPorts().paths.home(), '.agents');
  for (const name of CONTEXT_FILE_NAMES) {
    const path = join(directory, name);
    if (!existsSync(path)) continue;
    try {
      if (!statSync(path).isFile()) continue;
      const content = readFileSync(path, 'utf8').replace(/^\uFEFF/, '');
      return content.trim() ? [{ path: `~/.agents/${name}`, content }] : [];
    } catch (error) {
      console.warn(`[agent] 无法读取全局指令 ${path}`, error);
    }
  }
  return [];
}
