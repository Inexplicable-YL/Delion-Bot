import { useMutation, useQueryClient } from '@tanstack/react-query';
import { errorMessage } from '../../../core/protocol/contract';
import { ConfirmDialog } from '../../../ui/Dialog';
import { showToast } from '../../../ui/Toast';
import { useNavigationStore } from './view';

export function RestoreDialog() {
  const request = useNavigationStore((state) => state.restoreRequest);
  const queryClient = useQueryClient();
  const restore = useMutation({
    mutationFn: async (pending: NonNullable<typeof request>) => {
      const open = await pending.restore();
      if (pending.kind === 'chat') {
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: ['chat', 'archived'] }),
          queryClient.invalidateQueries({ queryKey: ['chat', 'session-search'] }),
          queryClient.invalidateQueries({ queryKey: ['search'] }),
        ]);
      }
      return open;
    },
    onSuccess: (open) => {
      useNavigationStore.setState({ restoreRequest: null });
      open();
    },
    onError: (cause) =>
      showToast({ variant: 'error', title: '恢复失败', description: errorMessage(cause) }),
  });
  const chat = request?.kind === 'chat';

  return (
    <ConfirmDialog
      open={request !== null}
      onOpenChange={(open) => {
        if (!open && !restore.isPending) useNavigationStore.setState({ restoreRequest: null });
      }}
      title={<span className="wrap-anywhere">恢复“{request?.title}”？</span>}
      description={
        chat ? '打开已归档的对话前，请先恢复。' : '此条目已归档。恢复后将移回资料库根目录并打开。'
      }
      confirmLabel={restore.isPending ? '正在恢复…' : '恢复并打开'}
      busy={restore.isPending}
      onConfirm={() => {
        if (request) restore.mutate(request);
      }}
    />
  );
}
