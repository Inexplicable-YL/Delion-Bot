import { useQuery } from '@tanstack/react-query';
import {
  CodeBracketIcon as CodeXml,
  FolderOpenIcon as FolderOpen,
} from '@heroicons/react/24/outline';
import type { FileChangeSummary } from '../../../core/protocol/agent';
import { ChangedFile, ChangesCard } from '../../../ui/agent/Changes';
import { showToast } from '../../../ui/Toast';
import { agentClient, chatClient } from './client';
import { errorMessage } from '../../../core/protocol/contract';
import { useChatTabSource } from './ChatSource';
import { reviewTabId } from './review/tab-id';
import { basenameOf, dirnameOf } from './review/ViewUtils';

const fileManagerName = window.delionBot?.platform === 'darwin' ? 'Finder' : '资源管理器';

function TurnFileRow({
  sessionId,
  turnId,
  file,
}: {
  sessionId: string;
  turnId: string;
  file: FileChangeSummary;
}) {
  const { workbench } = useChatTabSource();
  const fail = (cause: unknown) =>
    showToast({ variant: 'error', title: '打开失败', description: errorMessage(cause) });
  return (
    <ChangedFile
      counts={file.stat ?? undefined}
      deleted={file.status === 'deleted'}
      directory={dirnameOf(file.path)}
      name={basenameOf(file.path)}
      onOpen={() => {
        void chatClient
          .locateFile({ sessionId, path: file.path })
          .then((absolute) => workbench.openDocument(absolute, { aside: true }))
          .catch(fail);
      }}
      onReview={() =>
        workbench.open(reviewTabId({ kind: 'turn', sessionId, turnId, path: file.path }), {
          aside: true,
        })
      }
      openWith={[
        {
          key: 'vscode',
          icon: <CodeXml className="text-accent" />,
          label: 'VS Code',
          onSelect: () => void chatClient.openInVsCode({ sessionId, path: file.path }).catch(fail),
        },
        {
          key: 'reveal',
          icon: <FolderOpen />,
          label: fileManagerName,
          onSelect: () => void chatClient.revealFile({ sessionId, path: file.path }).catch(fail),
        },
      ]}
      path={file.path}
    />
  );
}

export function TurnChangesCard({ sessionId, turnId }: { sessionId: string; turnId: string }) {
  const { data: record } = useQuery({
    queryKey: ['chat', 'turn-changes', sessionId, turnId],
    queryFn: () => agentClient['read-turn-changes']({ sessionId, turnId, includeStats: true }),
    staleTime: Infinity,
  });

  if (!record || record.files.length === 0) return null;

  const total = record.files.reduce(
    (sum, file) => ({
      added: sum.added + (file.stat?.added ?? 0),
      deleted: sum.deleted + (file.stat?.deleted ?? 0),
    }),
    { added: 0, deleted: 0 },
  );
  return (
    <ChangesCard
      counts={total}
      fileCount={record.files.length}
      warning={
        record.state === 'partial' && record.warnings.length > 0
          ? `部分内容未能记录：${record.warnings[0]}${
              record.warnings.length > 1 ? ` 等 ${record.warnings.length} 项` : ''
            }`
          : undefined
      }
    >
      {record.files.map((file) => (
        <TurnFileRow file={file} key={file.path} sessionId={sessionId} turnId={turnId} />
      ))}
    </ChangesCard>
  );
}
