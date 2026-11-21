import type { ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  DocumentIcon as FileCode2,
  ExclamationTriangleIcon as TriangleAlert,
} from '@heroicons/react/24/outline';
import type { TabId } from '../../../../app/module';
import { diffStatOf } from '../../../../core/protocol/diff';
import { PanelHeader } from '../../../../ui/PanelHeader';
import type { FileChangeDetail } from '../../../../core/protocol/agent';
import { agentClient, chatClient } from '../client';
import { parseReviewTabId } from './tab-id';
import { Centered, STATUS_TEXT, basenameOf, dirnameOf } from './ViewUtils';
import { DiffScroller, PatchDiffView } from './PierreDiff';
import { errorMessage } from '../../../../core/protocol/contract';

export function ReviewTab({ tabId }: { tabId: TabId; groupId: string }) {
  const target = parseReviewTabId(tabId);
  if (target?.kind === 'uncommitted')
    return <UncommittedFileReview projectId={target.projectId} path={target.path} />;
  if (target?.kind === 'turn')
    return (
      <TurnFileReview path={target.path} sessionId={target.sessionId} turnId={target.turnId} />
    );
  return (
    <Shell>
      <Centered>无效的审阅标签</Centered>
    </Shell>
  );
}

function TurnFileReview({
  sessionId,
  turnId,
  path,
}: {
  sessionId: string;
  turnId: string;
  path: string;
}) {
  const { data: detail, error } = useQuery({
    queryKey: ['chat', 'turn-file-change', sessionId, turnId, path],
    queryFn: () => agentClient['read-turn-file-change']({ sessionId, turnId, path }),
    staleTime: Infinity,
  });

  return <FileReview detail={detail} error={error} />;
}

function UncommittedFileReview({ projectId, path }: { projectId: string; path: string }) {
  const { data: detail, error } = useQuery({
    queryKey: ['chat', 'uncommitted-file', projectId, path],
    queryFn: async () => {
      const {
        before: _before,
        after: _after,
        ...detail
      } = await chatClient.readUncommittedFileChange({
        projectId,
        path,
      });
      return detail;
    },
    gcTime: 0,
  });
  return <FileReview detail={detail} error={error} />;
}

function FileReview({
  detail,
  error,
}: {
  detail: Omit<FileChangeDetail, 'before' | 'after'> | undefined;
  error: Error | null;
}) {
  if (error)
    return (
      <Shell>
        <Centered>
          <TriangleAlert aria-hidden className="size-4 text-ink-2" />
          {errorMessage(error)}
        </Centered>
      </Shell>
    );
  if (!detail)
    return (
      <Shell>
        <Centered role="status">正在读取变更…</Centered>
      </Shell>
    );

  const stat = diffStatOf(detail.patch);
  return (
    <Shell>
      <PanelHeader>
        <FileCode2 aria-hidden className="size-4 shrink-0 text-ink-2" />
        <span className="shrink-0 text-ui-headline">{basenameOf(detail.path)}</span>
        <span className="min-w-0 truncate text-ui-subhead text-ink-2" title={detail.path}>
          {dirnameOf(detail.path)}
        </span>
        <span className="shrink-0 text-ui-subhead text-ink-2">· {STATUS_TEXT[detail.status]}</span>
        <span className="ml-auto flex shrink-0 gap-1.5 font-mono text-ui-subhead">
          {stat && stat.added > 0 && <span className="text-success">+{stat.added}</span>}
          {stat && stat.deleted > 0 && <span className="text-danger">-{stat.deleted}</span>}
        </span>
      </PanelHeader>
      {detail.note && (
        <p className="flex shrink-0 items-start gap-1.5 border-b border-line px-3 py-1.5 text-ui-subhead text-ink-2">
          <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
          {detail.note}
        </p>
      )}
      {detail.patch ? (
        <DiffScroller>
          <PatchDiffView patch={detail.patch} />
        </DiffScroller>
      ) : (
        <Centered>此文件没有可展示的文本差异</Centered>
      )}
    </Shell>
  );
}

function Shell({ children }: { children: ReactNode }) {
  return (
    <section aria-label="改动审阅" className="flex min-h-0 min-w-0 flex-1 flex-col bg-surface">
      {children}
    </section>
  );
}
