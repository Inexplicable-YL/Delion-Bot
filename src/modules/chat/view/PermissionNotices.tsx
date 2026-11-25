import { ShieldExclamationIcon } from '@heroicons/react/24/outline';
import { useState } from 'react';
import { Button } from '../../../ui/Button';
import { ToastCard } from '../../../ui/Toast';
import { useSessions } from './sessions';

const MAX_NOTICES = 3;

export function PermissionNotices({
  activeSessionId,
  onOpen,
}: {
  activeSessionId: string | null;
  onOpen: (sessionId: string, projectId: string | null) => void;
}) {
  const permissions = useSessions((state) => state.permissions);
  const lists = useSessions((state) => state.lists);
  const [dismissed, setDismissed] = useState<readonly string[]>([]);
  const notices = Object.entries(permissions)
    .flatMap(([sessionId, requests]) => {
      const request = requests?.[0];
      if (!request || sessionId === activeSessionId || dismissed.includes(request.id)) return [];
      const [pool, list] =
        Object.entries(lists).find(([, sessions]) =>
          sessions.some((session) => session.id === sessionId),
        ) ?? [];
      return [
        {
          sessionId,
          request,
          pool,
          title: list?.find((session) => session.id === sessionId)?.title ?? '对话',
        },
      ];
    })
    .slice(-MAX_NOTICES);

  if (notices.length === 0) return null;
  return (
    <section
      aria-label="审批提醒"
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 bottom-app-inset z-toast flex flex-col items-end gap-2 px-app pb-3 max-md:bottom-toast-mobile max-md:items-center"
    >
      {notices.map(({ sessionId, request, pool, title }) => (
        <ToastCard
          key={request.id}
          variant="neutral"
          icon={ShieldExclamationIcon}
          title="需要你的审批"
          className="animate-toast-in items-center motion-reduce:animate-none"
          onClose={() => setDismissed((ids) => [...ids, request.id])}
          action={
            <Button
              size="sm"
              variant="secondary"
              onClick={() =>
                onOpen(
                  sessionId,
                  pool === undefined
                    ? (useSessions.getState().chats[sessionId]?.projectId ?? null)
                    : pool === 'general'
                      ? null
                      : pool,
                )
              }
            >
              前往审批
            </Button>
          }
        >
          <p className="mt-0.5 truncate text-ui-subhead text-ink-2">
            {title} · {request.title}
          </p>
        </ToastCard>
      ))}
    </section>
  );
}
