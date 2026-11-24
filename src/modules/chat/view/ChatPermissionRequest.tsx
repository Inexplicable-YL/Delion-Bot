import { ChevronDownIcon, ShieldCheckIcon } from '@heroicons/react/24/outline';
import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { errorMessage } from '../../../core/protocol/contract';
import { Card } from '../../../ui/Card';
import { cn } from '../../../ui/cn';
import { ConfirmDialog } from '../../../ui/Dialog';
import { IconButton } from '../../../ui/IconButton';
import { showToast } from '../../../ui/Toast';
import type { PermissionRequest } from '../contract';
import { chatClient } from './client';

type Decision = 'once' | 'always' | 'deny';

const optionRow =
  'flex w-full min-w-0 items-center gap-2.5 rounded-control px-2.5 py-1 text-left transition-colors duration-base focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-ink has-[input:focus-visible]:bg-hover';
const optionBadge =
  'grid size-6 shrink-0 place-items-center rounded-chip bg-inset text-ui-subhead text-ink-2 tabular-nums shadow-hairline';

export function ChatPermissionRequest({
  request,
  sessionId,
}: {
  request: PermissionRequest;
  sessionId: string;
}) {
  const [note, setNote] = useState('');
  const [detailed, setDetailed] = useState(false);
  const decision = useMutation({
    mutationFn: async (choice: Decision) => {
      await chatClient.decidePermissionRequest({
        sessionId,
        id: request.id,
        decision: choice,
        ...(choice === 'deny' && note.trim() && { note: note.trim() }),
      });
    },
    onError: (cause) =>
      showToast({ variant: 'error', title: '提交决定失败', description: errorMessage(cause) }),
  });
  const decide = (choice: Decision) => {
    if (!decision.isPending) decision.mutate(choice);
  };
  if (request.kind === 'full')
    return (
      <ConfirmDialog
        open
        onOpenChange={(open) => {
          if (!open) decide('deny');
        }}
        title={request.title}
        description="Agent 将获得当前用户的文件、终端和网络权限。后续操作无需逐次批准。"
        confirmLabel="启用完全访问"
        acknowledgement="我已了解风险，并愿意继续"
        onConfirm={() => decide('once')}
        busy={decision.isPending}
        destructive
      />
    );
  const options: { label: string; choice: Decision }[] = [
    { label: '允许本次', choice: 'once' },
    ...(request.grant
      ? [
          {
            label: `${request.grant.scope === 'project' ? '本项目' : '本会话'}中始终允许${request.grant.label}`,
            choice: 'always' as const,
          },
        ]
      : []),
    { label: note.trim() ? '拒绝并告诉 Agent' : '拒绝', choice: 'deny' },
  ];
  return (
    <Card asChild variant="surface">
      <section
        aria-label="权限审批"
        className="grid gap-3"
        onKeyDown={(event) => {
          const typing = event.target instanceof HTMLInputElement;
          if (event.key === 'Escape') {
            event.preventDefault();
            decide('deny');
            return;
          }
          const option = options[Number(event.key) - 1];
          if (!typing && option) {
            event.preventDefault();
            decide(option.choice);
            return;
          }
          if (!typing && Number(event.key) === options.length + 1) {
            event.preventDefault();
            event.currentTarget.querySelector('input')?.focus();
            return;
          }
          if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
          const targets = [
            ...event.currentTarget.querySelectorAll<HTMLElement>('[data-option], input'),
          ];
          const index = targets.indexOf(event.target as HTMLElement);
          const next = targets[index + (event.key === 'ArrowDown' ? 1 : -1)];
          if (index < 0 || !next) return;
          event.preventDefault();
          next.focus();
        }}
      >
        <div className="flex min-w-0 items-center gap-2">
          <h3
            aria-live="polite"
            className="flex min-w-0 flex-1 items-center gap-2 text-ui-title-3 text-ink"
          >
            <ShieldCheckIcon aria-hidden="true" className="size-4 shrink-0 text-ink-2" />
            <span className="min-w-0 truncate">{request.title}</span>
          </h3>
          {request.fields.length > 0 && (
            <IconButton
              aria-controls={`${request.id}-fields`}
              aria-expanded={detailed}
              aria-label={detailed ? '收起请求内容' : '展开请求内容'}
              onClick={() => setDetailed(!detailed)}
              size="xs"
            >
              <ChevronDownIcon
                className={cn('transition-transform duration-fast', detailed && 'rotate-180')}
              />
            </IconButton>
          )}
        </div>
        {request.fields.length > 0 && (
          <dl
            className={cn('grid min-w-0 gap-1', detailed && 'max-h-60 overflow-y-auto')}
            id={`${request.id}-fields`}
          >
            {request.fields.map(({ label, value }, index) => (
              <div key={`${label}:${index}`} className="flex min-w-0 items-baseline gap-3">
                <dt className="w-14 shrink-0 text-ui-subhead text-ink-2">{label}</dt>
                <dd
                  className={cn(
                    'min-w-0 flex-1 font-mono text-ui-callout text-ink',
                    detailed ? 'wrap-anywhere whitespace-pre-wrap' : 'truncate',
                  )}
                  dir="auto"
                >
                  {value.replace(/\p{Cf}/gu, (char) => `\\u{${char.codePointAt(0)!.toString(16)}}`)}
                </dd>
              </div>
            ))}
          </dl>
        )}
        <div className="-mx-2.5 grid gap-0.5">
          {options.map(({ label, choice }, index) => (
            <button
              autoFocus={index === 0}
              className={cn(optionRow, 'enabled:hover:bg-hover disabled:cursor-default')}
              data-option
              disabled={decision.isPending}
              key={choice}
              onClick={() => decide(choice)}
              type="button"
            >
              <span aria-hidden="true" className={optionBadge}>
                {index + 1}
              </span>
              <span className="min-w-0 flex-1 wrap-anywhere text-ui-body text-ink">{label}</span>
            </button>
          ))}
          <label className={cn(optionRow, !decision.isPending && 'cursor-text hover:bg-hover')}>
            <span aria-hidden="true" className={optionBadge}>
              {options.length + 1}
            </span>
            <input
              aria-label="拒绝时告诉 Agent 的说明"
              className="min-w-0 flex-1 bg-transparent text-ui-body text-ink outline-none placeholder:text-ink-2"
              disabled={decision.isPending}
              maxLength={2000}
              onChange={(event) => setNote(event.currentTarget.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && note.trim()) {
                  event.preventDefault();
                  decide('deny');
                }
              }}
              placeholder="告诉 Agent 换一种做法，按 Enter 拒绝并发送"
              value={note}
            />
          </label>
        </div>
        <p className="text-ui-caption text-ink-2">按数字键选择，Esc 拒绝</p>
      </section>
    </Card>
  );
}
