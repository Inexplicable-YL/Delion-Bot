import { useState } from 'react';
import { ArrowDownTrayIcon as Download } from '@heroicons/react/24/outline';
import { DocumentToolbarButton } from '../../../ui/DocumentToolbar';
import { Spinner } from '../../../ui/Spinner';
import { showToast } from '../../../ui/Toast';
import { errorMessage } from '../../../core/protocol/contract';
import { parseRemoteNodeId } from '../contract';
import { workspaceClient } from './client';

export function DownloadFileButton({ entryId }: { entryId: string }) {
  const [busy, setBusy] = useState(false);
  const download = () => {
    const remote = parseRemoteNodeId(entryId);
    setBusy(true);
    (remote ? workspaceClient.downloadRemoteFile(remote) : workspaceClient.downloadFile(entryId))
      .catch((cause) =>
        showToast({ variant: 'error', title: '下载失败', description: errorMessage(cause) }),
      )
      .finally(() => setBusy(false));
  };
  return (
    <DocumentToolbarButton label="下载" disabled={busy || !window.delionBot} onClick={download}>
      {busy ? <Spinner size="xs" /> : <Download />}
    </DocumentToolbarButton>
  );
}
