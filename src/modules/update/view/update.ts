import { create } from 'zustand';
import { errorMessage } from '../../../core/protocol/contract';
import { showToast } from '../../../ui/Toast';
import type { UpdateReason, UpdateSnapshot, UpdateStep } from '../contract';
import { onUpdateEvent, updateClient } from './client';

export type UpdateAction = UpdateStep;

export interface UpdateView {
  status: string | null;
  action: UpdateAction | null;
  label: string | null;
  progress: number | null;
}

const REASON_STATUS: Record<UpdateReason, string> = {
  'not-packaged': '开发运行不支持应用内更新',
  'platform-unsupported': '当前平台暂未提供应用内更新',
  'feed-not-configured': '此安装包未配置自动更新',
  'feed-unavailable': '暂时无法获取更新信息，请稍后重试',
  'invalid-update': '更新文件校验失败，请重新下载',
  cancelled: '已取消',
  failed: '更新失败',
};

function failureAction(
  reason: UpdateReason,
  failedAt: UpdateStep | null,
): { action: UpdateAction | null; label: string | null } {
  if (
    reason === 'not-packaged' ||
    reason === 'platform-unsupported' ||
    reason === 'feed-not-configured'
  )
    return { action: null, label: null };
  return { action: failedAt ?? 'check', label: '重试' };
}

export function updateView(state: UpdateSnapshot): UpdateView {
  switch (state.phase) {
    case 'idle':
      return { status: null, action: 'check', label: '检查更新', progress: null };
    case 'checking':
      return { status: '正在检查…', action: null, label: null, progress: null };
    case 'up-to-date':
      return { status: '已是最新版本', action: 'check', label: '再检查一次', progress: null };
    case 'available':
      return {
        status: state.version ? `有新版本 ${state.version}` : '有新版本',
        action: 'download',
        label: '下载更新',
        progress: null,
      };
    case 'downloading':
      return {
        status: state.progress >= 1 ? '下载已传输完成，正在校验并准备安装…' : '正在下载更新',
        action: null,
        label: null,
        progress: state.progress,
      };
    case 'ready':
      return {
        status: '更新已下载，安装时将退出 Delion Bot 并打开安装向导',
        action: 'install',
        label: '安装更新',
        progress: null,
      };
    case 'installing':
      return {
        status: '正在打开安装向导，Delion Bot 即将退出',
        action: null,
        label: null,
        progress: null,
      };
    case 'unsupported':
    case 'error': {
      const reason = state.reason ?? 'failed';
      return {
        status:
          state.failedAt === 'install'
            ? '无法启动安装向导，请下载安装包后手动安装'
            : REASON_STATUS[reason],
        ...failureAction(reason, state.failedAt),
        progress: null,
      };
    }
  }
}

export function pendingUpdate(state: UpdateSnapshot): boolean {
  return state.phase === 'available' || state.phase === 'downloading' || state.phase === 'ready';
}

interface UpdateState {
  snapshot: UpdateSnapshot | null;
  preparingInstall: boolean;
  dismissedVersion: string | null;
  beforeInstall: (() => Promise<void>) | null;
}

export const useUpdateState = create<UpdateState>(() => ({
  snapshot: null,
  preparingInstall: false,
  dismissedVersion: null,
  beforeInstall: null,
}));

export function startUpdateMirror() {
  if (!window.delionBot) return;
  if (window.delionBot.updatedOnLaunch) {
    showToast({ variant: 'success', title: `已更新至 Delion Bot ${window.delionBot.version}` });
  }
  const receive = (snapshot: UpdateSnapshot) => {
    const previous = useUpdateState.getState().snapshot;
    useUpdateState.setState({ snapshot });
    if (
      snapshot.phase === 'error' &&
      snapshot.failedAt === 'install' &&
      (previous?.phase !== 'error' || previous.failedAt !== 'install')
    ) {
      showToast({
        variant: 'error',
        title: '无法启动安装向导',
        description: updateView(snapshot).status ?? '请下载安装包后手动安装。',
      });
    }
  };
  let receivedPush = false;
  onUpdateEvent('state', (snapshot) => {
    receivedPush = true;
    receive(snapshot);
  });
  void updateClient.state().then(
    (snapshot) => {
      if (!receivedPush) receive(snapshot);
    },
    () => {},
  );
}

export async function runUpdateAction(action: UpdateAction): Promise<boolean> {
  if (!window.delionBot) return false;
  if (action === 'install') {
    if (useUpdateState.getState().preparingInstall) return false;
    useUpdateState.setState({ preparingInstall: true });
    try {
      await useUpdateState.getState().beforeInstall?.();
    } catch (error) {
      useUpdateState.setState({ preparingInstall: false });
      showToast({
        variant: 'error',
        title: '暂时不能安装',
        description: error instanceof Error ? error.message : '保存工作区失败，请重试。',
      });
      return false;
    }
  }
  try {
    const result = await updateClient[action]();
    const current = useUpdateState.getState().snapshot;
    if (
      action === 'download' &&
      result.phase === 'ready' &&
      current?.phase === 'downloading' &&
      current.version === result.version
    ) {
      useUpdateState.setState({ snapshot: result });
    }
    if (result.phase === 'error' || result.phase === 'unsupported') {
      return false;
    }
    return true;
  } catch (error) {
    console.error('Update action failed', error);
    showToast({
      variant: 'error',
      title: '更新操作失败',
      description: errorMessage(error),
    });
    return false;
  } finally {
    if (action === 'install') useUpdateState.setState({ preparingInstall: false });
  }
}

export async function deferInstall(): Promise<boolean> {
  try {
    if (!window.delionBot) return false;
    await updateClient.deferInstall();
    return true;
  } catch (error) {
    console.error('Defer update install failed', error);
    showToast({
      variant: 'error',
      title: '设置提醒失败',
      description: errorMessage(error),
    });
    return false;
  }
}
