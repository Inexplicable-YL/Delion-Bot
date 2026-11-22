import { readdirSync, statSync } from 'node:fs';
import { basename, join, relative, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const sourceDirs = ['src', 'test', 'scripts'];
const tsxExceptions = new Set(['index.tsx', 'main.tsx']);
const kebab = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const pascal = /^[A-Z][A-Za-z0-9]*$/;

function* files(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) yield* files(path);
    else yield path;
  }
}

const violations: string[] = [];
for (const dir of sourceDirs) {
  for (const path of files(join(root, dir))) {
    const name = basename(path);
    if (!name.endsWith('.ts') && !name.endsWith('.tsx')) continue;
    const file = relative(root, path).replaceAll('\\', '/');
    const stem = name.replace(/\.(?:ts|tsx)$/, '').replace(/\.(?:d|test|remote\.test)$/, '');
    if (name.endsWith('.tsx') && file.startsWith('src/')) {
      if (!tsxExceptions.has(name) && !pascal.test(stem)) {
        violations.push(`${file}：组件文件应使用大驼峰`);
      }
      continue;
    }
    if (!kebab.test(stem)) violations.push(`${file}：应使用小写短横线`);
  }
}

if (violations.length > 0) {
  console.log(`文件名不符合规范 ${violations.length} 处：\n${violations.join('\n')}`);
  process.exit(1);
}
