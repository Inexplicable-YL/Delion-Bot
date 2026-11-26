import { useState } from 'react';
import {
  ArrowDownTrayIcon as Download,
  DocumentIcon as Document,
  DocumentTextIcon as DocumentText,
  HashtagIcon as Hashtag,
} from '@heroicons/react/24/outline';
import { DocumentToolbarButton } from '../../../ui/DocumentToolbar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from '../../../ui/DropdownMenu';
import { Spinner } from '../../../ui/Spinner';
import { showToast } from '../../../ui/Toast';
import { createClient, errorMessage } from '../../../core/protocol/contract';
import { noteContract } from '../contract';

const noteClient = createClient(noteContract, window.delionBot?.bridge);

type ExportFormat = 'pdf' | 'docx' | 'md';

async function exportMarkdown(
  format: ExportFormat,
  title: string,
  text: string,
  resolveImage: (src: string) => string,
) {
  if (format === 'md') return noteClient.exportDocument({ format, title, text });
  const { fetchImage, parseMarkdown } = await import('./export-source');
  const tree = parseMarkdown(text);
  const loadImage = (src: string) => fetchImage(resolveImage(src));
  if (format === 'pdf') {
    const { markdownToPrintHtml } = await import('./export-html');
    const html = await markdownToPrintHtml(tree, title, loadImage);
    return noteClient.exportDocument({ format, title, html });
  }
  const { markdownToDocx } = await import('./export-docx');
  const bytes = await markdownToDocx(tree, title, loadImage);
  return noteClient.exportDocument({ format, title, bytes });
}

export function ExportMenu({
  filename,
  text,
  resolveImage,
}: {
  filename: string;
  text: string;
  resolveImage: (src: string) => string;
}) {
  const [busy, setBusy] = useState(false);
  const title = filename.replace(/\.(md|markdown|mdx)$/i, '') || filename;
  const run = (format: ExportFormat) => {
    setBusy(true);
    exportMarkdown(format, title, text, resolveImage)
      .catch((cause) =>
        showToast({ variant: 'error', title: '下载失败', description: errorMessage(cause) }),
      )
      .finally(() => setBusy(false));
  };
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <DocumentToolbarButton label="下载" disabled={busy || !window.delionBot}>
          {busy ? <Spinner size="xs" /> : <Download />}
        </DocumentToolbarButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuItem onSelect={() => run('md')}>
          <Hashtag />
          下载为 Markdown
          <DropdownMenuShortcut>.md</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => run('docx')}>
          <DocumentText />
          下载为 Word
          <DropdownMenuShortcut>.docx</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => run('pdf')}>
          <Document />
          下载为 PDF
          <DropdownMenuShortcut>.pdf</DropdownMenuShortcut>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
