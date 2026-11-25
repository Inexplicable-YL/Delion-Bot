import { QuestionMarkCircleIcon, ShieldExclamationIcon } from '@heroicons/react/24/outline';
import { useState } from 'react';
import { Button } from '../../../ui/Button';
import { ToastCard } from '../../../ui/Toast';
import { useRuns } from './runs';
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
  const runs = useRuns((state) => state.bySession);
  const [dismissed, setDismissed] = useState<readonly string[]>([]);
  const waiting = [
    ...Object.entries(permissions).flatMap(([sessionId, requests]) => {
      const request = requests?.[0];
      return request ? [{ sessionId, id: request.id, detail: request.title, approval: true }] : [];
    }),
    ...Object.entries(runs).flatMap(([sessionId, run]) =>
      run.status === 'waiting_input' && !permissions[sessionId]?.length
        ? [{ sessionId, id: run.runId, detail: null, approval: false }]
        : [],
    ),
  ];
  const notices = waiting
    .flatMap((notice) => {
      if (notice.sessionId === activeSessionId || dismissed.includes(notice.id)) return [];
      const [pool, list] =
        Object.entries(lists).find(([, sessions]) =>
          sessions.some((session) => session.id === notice.sessionId),
        ) ?? [];
      return [
        {
          ...notice,
          pool,
          title: list?.find((session) => session.id === notice.sessionId)?.title ?? '对话',
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
      {notices.map(({ sessionId, id, detail, approval, pool, title }) => (
        <ToastCard
          key={id}
          variant="neutral"
          icon={approval ? ShieldExclamationIcon : QuestionMarkCircleIcon}
          title={approval ? '需要你的审批' : '需要你的回答'}
          className="animate-toast-in items-center motion-reduce:animate-none"
          onClose={() => setDismissed((ids) => [...ids, id])}
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
              {approval ? '前往审批' : '前往回答'}
            </Button>
          }
        >
          <p className="mt-0.5 truncate text-ui-subhead text-ink-2">
            {detail ? `${title} · ${detail}` : title}
          </p>
        </ToastCard>
      ))}
    </section>
  );
}
