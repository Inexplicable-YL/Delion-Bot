import { Button } from '../../../ui/Button';
import { useUpdateState, deferInstall, runUpdateAction } from './update';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '../../../ui/Dialog';

export function UpdatePrompt() {
  const state = useUpdateState((snapshot) => snapshot.snapshot);
  const preparing = useUpdateState((snapshot) => snapshot.preparingInstall);
  const dismissedVersion = useUpdateState((snapshot) => snapshot.dismissedVersion);
  const installing = state?.phase === 'installing';
  const busy = preparing || installing;
  const version = state?.version ?? state?.currentVersion;
  const ready = state?.phase === 'ready';
  if (!busy && (!state || !ready || dismissedVersion === version)) return null;

  const dismiss = () => useUpdateState.setState({ dismissedVersion: version ?? null });
  const choose = async (action: () => Promise<boolean>) => {
    if (await action()) dismiss();
  };

  return (
    <Dialog onOpenChange={(open) => !busy && !open && dismiss()} open>
      <DialogContent
        size="sm"
        onEscapeKeyDown={(event) => {
          if (busy) event.preventDefault();
        }}
        onPointerDownOutside={(event) => {
          if (busy) event.preventDefault();
        }}
      >
        <DialogTitle>
          {busy
            ? installing
              ? '正在打开安装向导'
              : '正在保存工作区'
            : state?.version
              ? `新版本 ${state.version}`
              : '新版本'}
        </DialogTitle>
        {!busy && <DialogDescription>退出后自动安装，终端任务会结束。</DialogDescription>}
        {!busy && (
          <DialogFooter>
            <Button autoFocus onClick={() => void choose(deferInstall)} variant="secondary">
              下次启动时提醒
            </Button>
            <Button onClick={() => void choose(() => runUpdateAction('install'))}>
              退出并安装
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
