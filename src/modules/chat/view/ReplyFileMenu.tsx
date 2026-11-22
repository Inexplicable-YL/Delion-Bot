import { useQuery } from '@tanstack/react-query';
import { errorMessage } from '../../../core/protocol/contract';
import { ContextMenuItem } from '../../../ui/ContextMenu';
import { showToast } from '../../../ui/Toast';
import { chatClient } from './client';

export function ReplyFileMenu({
  sessionId,
  path,
  remote,
  directory,
}: {
  sessionId: string;
  path: string;
  remote: boolean;
  directory: boolean;
}) {
  const { data: hasVsCode } = useQuery({
    queryKey: ['chat', 'has-vs-code'],
    queryFn: () => chatClient.hasVsCode(undefined),
  });
  const file = { sessionId, path };
  const copy = (read: (input: typeof file) => Promise<string>) =>
    void read(file)
      .then((text) => navigator.clipboard.writeText(text))
      .catch((cause: unknown) =>
        showToast({ variant: 'error', title: '复制失败', description: errorMessage(cause) }),
      );
  const openFailed = (cause: unknown) =>
    showToast({ variant: 'error', title: '打开失败', description: errorMessage(cause) });
  return (
    <>
      <ContextMenuItem onSelect={() => copy(chatClient.referenceFilePath)}>
        复制路径
      </ContextMenuItem>
      {!directory && (
        <ContextMenuItem onSelect={() => copy(chatClient.readReferenceFile)}>
          复制文件内容
        </ContextMenuItem>
      )}
      {!remote && (
        <ContextMenuItem
          onSelect={() =>
            void (directory ? chatClient.openReferenceDirectory : chatClient.revealFile)(
              file,
            ).catch(openFailed)
          }
        >
          {window.delionBot?.platform === 'darwin' ? '在 Finder 中打开' : '在资源管理器中打开'}
        </ContextMenuItem>
      )}
      {hasVsCode && (
        <ContextMenuItem onSelect={() => void chatClient.openInVsCode(file).catch(openFailed)}>
          在 VS Code 中打开
        </ContextMenuItem>
      )}
    </>
  );
}
