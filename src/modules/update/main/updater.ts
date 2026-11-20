import { app, BrowserWindow } from 'electron';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { autoUpdater } from 'electron-updater';
import { emit } from '../../../core/ports';
import { savedPendingInstall, setPendingInstall } from '../../settings';
import {
  updateContract,
  type UpdateReason,
  type UpdateSnapshot,
  type UpdateStep,
} from '../contract';
import { failureEvent, initialUpdateState, reduceUpdate, type UpdateEvent } from './state';

export const BACKGROUND_CHECK_INTERVAL = 2 * 60 * 60 * 1000;
export const BACKGROUND_CHECK_DELAY = 30_000;
export const PENDING_INSTALL_DELAY = 5_000;
function unavailableReason(): UpdateReason | null {
  if (process.platform !== 'win32' && process.platform !== 'darwin') return 'platform-unsupported';
  if (app.isPackaged && !existsSync(join(process.resourcesPath, 'app-update.yml')))
    return 'feed-not-configured';
  return null;
}

let snapshot: UpdateSnapshot | null = null;
let configured = false;

export function currentState(): UpdateSnapshot {
  if (!snapshot) {
    snapshot = initialUpdateState({ currentVersion: app.getVersion() });
    const reason = unavailableReason();
    if (reason) {
      snapshot = {
        ...snapshot,
        phase: 'unsupported',
        reason,
        failedAt: 'check',
      };
    }
  }
  return snapshot;
}

function dispatch(event: UpdateEvent): UpdateSnapshot {
  const previous = currentState();
  snapshot = reduceUpdate(previous, event);
  if (snapshot !== previous) emit(updateContract, 'state', snapshot);
  return snapshot;
}

function fail(step: UpdateStep, error: unknown): UpdateSnapshot {
  const code = (error as { code?: string } | null)?.code ?? '';
  const reason: UpdateReason =
    code === 'ERR_UPDATER_LATEST_VERSION_NOT_FOUND' ||
    code === 'ERR_UPDATER_CHANNEL_FILE_NOT_FOUND' ||
    code.startsWith('ERR_HTTP_')
      ? 'feed-unavailable'
      : code.includes('CHECKSUM') ||
          code === 'ERR_UPDATER_INVALID_SIGNATURE' ||
          code === 'ERR_UPDATER_INVALID_UPDATE_INFO'
        ? 'invalid-update'
        : code === 'ERR_CANCELLED'
          ? 'cancelled'
          : 'failed';
  return dispatch(
    failureEvent(step, reason, error instanceof Error ? error.message : String(error)),
  );
}

function configureUpdater(): void {
  if (configured) return;
  configured = true;
  // 检查、下载和安装分别由用户流程驱动，退出或推迟提醒不能绕过保存工作区。
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.autoRunAppAfterInstall = true;
  autoUpdater.allowPrerelease = false;
  autoUpdater.channel = 'latest';
  autoUpdater.allowDowngrade = false;
  autoUpdater.on('download-progress', ({ percent, transferred, total }) => {
    dispatch({ type: 'download/progress', progress: percent / 100, transferred, total });
  });
  autoUpdater.on('update-downloaded', ({ version }) => {
    if (currentState().version === version) dispatch({ type: 'download/finished' });
  });
  autoUpdater.on('error', (error) => {
    // check/download 的 Promise 处理失败；安装器启动后只能通过事件报告错误。
    if (currentState().phase === 'installing') fail('install', error);
    else console.error('Update failed', error);
  });
}

export async function beginCheck(): Promise<UpdateSnapshot> {
  const previous = currentState();
  if (previous.phase === 'unsupported') return previous;
  const started = dispatch({ type: 'check/started' });
  if (started === previous) return started;
  if (!app.isPackaged) return dispatch(failureEvent('check', 'not-packaged', null));
  try {
    configureUpdater();
    const result = await autoUpdater.checkForUpdates();
    if (!result) throw new Error('更新检查未返回结果');
    const checkedAt = new Date().toISOString();
    return dispatch(
      result.isUpdateAvailable
        ? { type: 'check/available', version: result.updateInfo.version, checkedAt }
        : { type: 'check/up-to-date', checkedAt },
    );
  } catch (error) {
    return fail('check', error);
  }
}

export async function beginDownload(): Promise<UpdateSnapshot> {
  const previous = currentState();
  const started = dispatch({ type: 'download/started' });
  if (started === previous) return started;
  try {
    const files = await autoUpdater.downloadUpdate();
    if (files.length === 0) throw new Error('更新安装包未下载完成');
    return dispatch({ type: 'download/finished' });
  } catch (error) {
    return fail('download', error);
  }
}

export async function beginInstall(): Promise<UpdateSnapshot> {
  const previous = currentState();
  const started = dispatch({ type: 'install/started' });
  if (started === previous) return started;
  try {
    setPendingInstall(false);
    // 返回只表示已请求安装，不能宣称安装成功；新进程会从实际版本重新开始。
    autoUpdater.quitAndInstall(false, true);
    return currentState();
  } catch (error) {
    return fail('install', error);
  }
}

export function deferInstall(): void {
  if (currentState().phase === 'ready') setPendingInstall(true);
}

function hasWindow(): boolean {
  return BrowserWindow.getAllWindows().some((window) => !window.isDestroyed());
}

function backgroundCheck(): void {
  if (app.isPackaged && hasWindow()) void beginCheck();
}

export function startBackgroundUpdateCheck(): () => void {
  if (!app.isPackaged || unavailableReason()) return () => {};
  const timer = setInterval(backgroundCheck, BACKGROUND_CHECK_INTERVAL);
  const initial = setTimeout(backgroundCheck, BACKGROUND_CHECK_DELAY);
  const pending = setTimeout(() => {
    void preparePendingUpdate().catch((error) => console.error('Pending update failed', error));
  }, PENDING_INSTALL_DELAY);
  return () => {
    clearInterval(timer);
    clearTimeout(initial);
    clearTimeout(pending);
  };
}

/** 重启后重新核对更新并复用 updater 的下载缓存，只准备到 ready，仍需用户确认。 */
async function preparePendingUpdate(): Promise<void> {
  if (!app.isPackaged || !hasWindow() || !savedPendingInstall()) return;
  setPendingInstall(false);
  await beginCheck();
  if (currentState().phase === 'available') await beginDownload();
}
