import { app, type BrowserWindow, dialog } from 'electron';
import { cp, lstat, mkdir, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { basename, isAbsolute, join, relative } from 'node:path';
import { builtinSkillsDirectory } from '../../../core/capabilities/skills';
import { hostPorts } from '../../../core/ports';
import { availablePath } from '../../workspace';
import type { BackupResult } from '../contract';
import { cacheDirectoryNames } from './cache';

const databaseFiles = new Set(['delion.db', 'delion.db-wal', 'delion.db-shm', 'delion.db-journal']);

function backupFolderName(now: Date) {
  const pad = (value: number) => String(value).padStart(2, '0');
  const date = [now.getFullYear(), pad(now.getMonth() + 1), pad(now.getDate())].join('-');
  return `Delion Bot 备份 ${date} ${pad(now.getHours())}-${pad(now.getMinutes())}`;
}

function isInside(parent: string, child: string) {
  const rel = relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

async function skipLinks(source: string) {
  return !(await lstat(source)).isSymbolicLink();
}

async function skipCacheAndLinks(source: string) {
  if (cacheDirectoryNames.has(basename(source))) return false;
  return skipLinks(source);
}

export async function exportUserData(window: BrowserWindow | null): Promise<BackupResult> {
  const options = {
    title: '选择备份保存位置',
    buttonLabel: '导出到这里',
    properties: ['openDirectory', 'createDirectory'],
  } satisfies Electron.OpenDialogOptions;
  const picked = window
    ? await dialog.showOpenDialog(window, options)
    : await dialog.showOpenDialog(options);
  const parent = picked.filePaths[0];
  if (picked.canceled || !parent) return { status: 'cancelled' };

  const dataDirectory = app.getPath('userData');
  const workspace = hostPorts().paths.storage();
  const skills = builtinSkillsDirectory();
  for (const source of [dataDirectory, workspace, skills]) {
    if (isInside(source, parent)) {
      return { status: 'failed', reason: '不能保存到 Delion Bot 的数据目录里，请另选一个位置' };
    }
  }

  const destination = availablePath(parent, backupFolderName(new Date()), true);
  const backupData = join(destination, '应用数据');
  await mkdir(backupData, { recursive: true });
  hostPorts()
    .database()
    .exec(`VACUUM INTO '${join(backupData, 'delion.db').replaceAll("'", "''")}'`);

  const skipped: string[] = [];
  for (const entry of await readdir(dataDirectory)) {
    if (databaseFiles.has(entry)) continue;
    try {
      await cp(join(dataDirectory, entry), join(backupData, entry), {
        recursive: true,
        filter: skipCacheAndLinks,
      });
    } catch {
      skipped.push(entry);
    }
  }

  if (existsSync(workspace)) {
    try {
      await cp(workspace, join(destination, '工作目录'), {
        recursive: true,
        filter: skipLinks,
      });
    } catch {
      skipped.push('工作目录');
    }
  }
  if (existsSync(skills)) {
    try {
      await cp(skills, join(destination, '技能'), { recursive: true, filter: skipLinks });
    } catch {
      skipped.push('技能');
    }
  }
  return { status: 'exported', path: destination, skipped };
}
