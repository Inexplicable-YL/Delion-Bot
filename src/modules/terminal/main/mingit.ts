import { app } from 'electron';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

function bundledDir(): string {
  if (app.isPackaged) return join(process.resourcesPath, 'mingit');
  return join(app.getAppPath(), '.build', 'mingit');
}

export function bundledBash(): string | null {
  if (process.platform !== 'win32') return null;
  const bash = join(bundledDir(), 'usr', 'bin', 'bash.exe');
  return existsSync(bash) ? bash : null;
}

function systemBash(): string | null {
  if (process.platform === 'darwin') return existsSync('/bin/bash') ? '/bin/bash' : null;
  const candidates = [
    join(process.env.ProgramFiles ?? 'C:\\Program Files', 'Git', 'bin', 'bash.exe'),
    join(process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)', 'Git', 'bin', 'bash.exe'),
    join(process.env.LOCALAPPDATA ?? '', 'Programs', 'Git', 'bin', 'bash.exe'),
  ];
  return candidates.find((path) => existsSync(path)) ?? null;
}

export function locateBash(): string {
  if (process.platform === 'darwin') {
    const bash = systemBash();
    if (!bash) throw new Error('未找到 macOS 系统 Bash（/bin/bash），请检查系统环境');
    return bash;
  }
  const bash = systemBash() ?? bundledBash();
  if (!bash)
    throw new Error(
      '未找到 Git Bash：请安装 Git for Windows（https://git-scm.com/download/win）后重启 Delion Bot',
    );
  return bash;
}

function searchToolsDir(): string | null {
  const root = app.isPackaged
    ? join(process.resourcesPath, 'bin')
    : join(app.getAppPath(), 'vendor', 'bin');
  const dir = process.platform === 'darwin' ? join(root, `darwin-${process.arch}`) : root;
  const suffix = process.platform === 'win32' ? '.exe' : '';
  return ['rg', 'fd'].every((name) => existsSync(join(dir, `${name}${suffix}`))) ? dir : null;
}

export function prependRuntimePath(): void {
  if (process.platform === 'darwin') {
    const paths = (process.env.PATH ?? '').split(':').filter(Boolean);
    for (const path of [
      '/opt/homebrew/bin',
      '/usr/local/bin',
      '/usr/bin',
      '/bin',
      '/usr/sbin',
      '/sbin',
    ]) {
      if (!paths.includes(path)) paths.push(path);
    }
    process.env.PATH = paths.join(':');
  }
  if (bundledBash()) process.env.PATH = `${join(bundledDir(), 'cmd')};${process.env.PATH ?? ''}`;
  const tools = searchToolsDir();
  if (tools)
    process.env.PATH = `${tools}${process.platform === 'win32' ? ';' : ':'}${process.env.PATH ?? ''}`;
}
