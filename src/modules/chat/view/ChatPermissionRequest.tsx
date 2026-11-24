import { ShieldCheckIcon } from '@heroicons/react/24/outline';
import { useMutation } from '@tanstack/react-query';
import { errorMessage } from '../../../core/protocol/contract';
import { Button } from '../../../ui/Button';
import { Card } from '../../../ui/Card';
import { ConfirmDialog } from '../../../ui/Dialog';
import { showToast } from '../../../ui/Toast';
import type { PermissionRequest } from '../contract';
import { chatClient } from './client';

export function ChatPermissionRequest({
  request,
  sessionId,
}: {
  request: PermissionRequest;
  sessionId: string;
}) {
  const decision = useMutation({
    mutationFn: async (approved: boolean) => {
      await chatClient.decidePermissionRequest({ sessionId, id: request.id, approved });
    },
    onError: (cause) =>
      showToast({ variant: 'error', title: '提交决定失败', description: errorMessage(cause) }),
  });
  if (request.kind === 'full')
    return (
      <ConfirmDialog
        open
        onOpenChange={(open) => {
          if (!open && !decision.isPending) decision.mutate(false);
        }}
        title={request.title}
        description="Agent 将获得当前用户的文件、终端和网络权限。后续操作无需逐次批准。"
        confirmLabel="启用完全访问"
        onConfirm={() => decision.mutate(true)}
        busy={decision.isPending}
        destructive
      />
    );
  return (
    <Card asChild variant="surface">
      <section aria-label="权限审批" className="grid gap-4">
        <div className="flex min-w-0 items-center gap-2">
          <ShieldCheckIcon aria-hidden="true" className="size-5 shrink-0 text-ink-2" />
          <h3 aria-live="polite" className="text-ui-title-3">
            {request.title}
          </h3>
        </div>
        {request.fields.length > 0 && (
          <dl className="grid max-h-52 min-w-0 gap-3 overflow-y-auto rounded-control bg-inset p-3">
            {request.fields.map(({ label, value }, index) => (
              <div key={`${label}:${index}`} className="grid min-w-0 gap-1">
                <dt className="text-ui-subhead text-ink-2">{label}</dt>
                <dd className="wrap-anywhere whitespace-pre-wrap text-ui-callout" dir="auto">
                  {value.replace(/\p{Cf}/gu, (char) => `\\u{${char.codePointAt(0)!.toString(16)}}`)}
                </dd>
              </div>
            ))}
          </dl>
        )}
        <div className="flex flex-wrap justify-end gap-2">
          <Button
            variant="secondary"
            disabled={decision.isPending}
            onClick={() => decision.mutate(false)}
          >
            拒绝
          </Button>
          <Button
            variant="accent"
            disabled={decision.isPending}
            onClick={() => decision.mutate(true)}
          >
            允许本次
          </Button>
        </div>
      </section>
    </Card>
  );
}
