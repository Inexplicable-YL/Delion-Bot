import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

export function resolveSessionFile(cwd: string, rawPath: string): string {
  const target = resolve(cwd, rawPath);
  if (!existsSync(target)) throw new Error('文件不存在，可能已被移动或删除');
  return target;
}
