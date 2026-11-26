import { ChevronDownIcon } from '@heroicons/react/24/outline';
import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { errorMessage } from '../../../core/protocol/contract';
import { Card } from '../../../ui/Card';
import { cn } from '../../../ui/cn';
import { ConfirmDialog } from '../../../ui/Dialog';
import { IconButton } from '../../../ui/IconButton';
import { showToast } from '../../../ui/Toast';
import type { PermissionDecision, PermissionRequest } from '../contract';
import { chatClient } from './client';

const optionRow =
  'flex min-h-control-sm w-full min-w-0 items-center gap-2.5 rounded-control px-2 text-left text-ui-body transition-colors duration-fast';
const visible = (value: string) =>
  value.replace(/\p{Cf}/gu, (char) => `\\u{${char.codePointAt(0)!.toString(16)}}`);

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
    mutationFn: async (choice: PermissionDecision) => {
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
  const decide = (choice: PermissionDecision) => {
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
  const grant = request.grant;
  const grantScope = grant?.scope === 'project' ? '本项目' : '本会话';
  const options: { label: string; choice: PermissionDecision }[] = [
    { label: '允许本次', choice: 'once' },
    ...(grant
      ? [
          {
            label: `${grantScope}中始终允许${grant.label}`,
            choice: 'always' as const,
          },
          ...(grant.directoryLabel
            ? [
                {
                  label: `${grantScope}中始终允许${grant.directoryLabel}`,
                  choice: 'directory' as const,
                },
              ]
            : []),
        ]
      : []),
    { label: note.trim() ? '拒绝并告诉 Agent' : '拒绝', choice: 'deny' },
  ];
  const [primary, ...secondary] = request.fields;
  return (
    <Card asChild className="p-4" variant="surface">
      <section
        aria-label="权限审批"
        className="grid gap-2.5"
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
          <h3 aria-live="polite" className="min-w-0 flex-1 truncate text-ui-headline text-ink">
            {request.title}
          </h3>
          {request.fields.length > 0 && (
            <IconButton
              aria-controls={`${request.id}-fields`}
              aria-expanded={detailed}
              aria-label={detailed ? '收起请求内容' : '展开请求内容'}
              className="-my-1 -mr-1"
              onClick={() => setDetailed(!detailed)}
              size="xs"
            >
              <ChevronDownIcon
                className={cn('transition-transform duration-fast', detailed && 'rotate-180')}
              />
            </IconButton>
          )}
        </div>
        {primary && (
          <div className="grid min-w-0 gap-1" id={`${request.id}-fields`}>
            {detailed ? (
              <dl className="grid max-h-60 min-w-0 gap-1.5 overflow-y-auto">
                {request.fields.map(({ label, value }, index) => (
                  <div key={`${label}:${index}`} className="grid min-w-0 gap-0.5">
                    <dt className="text-ui-subhead text-ink-2">{label}</dt>
                    <dd
                      className="font-mono text-ui-callout wrap-anywhere whitespace-pre-wrap text-ink"
                      dir="auto"
                    >
                      {visible(value)}
                    </dd>
                  </div>
                ))}
              </dl>
            ) : (
              <>
                <p
                  className="line-clamp-8 font-mono text-ui-callout wrap-anywhere whitespace-pre-wrap text-ink"
                  dir="auto"
                  title={primary.label}
                >
                  {visible(primary.value)}
                </p>
                {secondary.length > 0 && (
                  <p className="line-clamp-3 text-ui-callout wrap-anywhere text-ink-2">
                    {secondary.map(({ value }) => visible(value)).join(' · ')}
                  </p>
                )}
              </>
            )}
          </div>
        )}
        <div className="-mx-2 grid gap-0.5">
          {options.map(({ label, choice }, index) => (
            <button
              autoFocus={index === 0}
              className={cn(
                optionRow,
                'text-ink outline-hidden enabled:hover:bg-hover focus-visible:bg-selected disabled:opacity-50',
              )}
              data-option
              disabled={decision.isPending}
              key={choice}
              onClick={() => decide(choice)}
              type="button"
            >
              <span aria-hidden="true" className="w-2.5 shrink-0 text-ink-2 tabular-nums">
                {index + 1}
              </span>
              <span className="min-w-0 flex-1 wrap-anywhere py-1">{visible(label)}</span>
            </button>
          ))}
          <input
            aria-label="拒绝时告诉 Agent 的说明"
            className={cn(
              optionRow,
              'bg-transparent pl-7 text-ink outline-none placeholder:text-ink-2 hover:bg-hover focus:bg-selected disabled:opacity-50',
            )}
            disabled={decision.isPending}
            maxLength={2000}
            onChange={(event) => setNote(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && note.trim()) {
                event.preventDefault();
                decide('deny');
              }
            }}
            placeholder="或告诉 Agent 换一种做法"
            value={note}
          />
        </div>
        <p className="text-ui-caption text-ink-2">Esc 拒绝</p>
      </section>
    </Card>
  );
}
