import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { BrowserWindow, session } from 'electron';
import { hostPorts } from '../../../core/ports';

const PRINT_PARTITION = 'note-print';

type ExportRequest =
  | { format: 'pdf'; title: string; html: string }
  | { format: 'docx'; title: string; bytes: Uint8Array };

async function printPdf(html: string): Promise<Uint8Array> {
  const directory = await mkdtemp(join(hostPorts().paths.temp(), 'delion-print-'));
  const file = join(directory, 'document.html');
  const fileUrl = pathToFileURL(file).href;
  await writeFile(file, html);
  session.fromPartition(PRINT_PARTITION).webRequest.onBeforeRequest((request, respond) =>
    respond({
      cancel: !(
        request.url === fileUrl ||
        request.url.startsWith('data:') ||
        (request.resourceType === 'image' && /^https?:/i.test(request.url))
      ),
    }),
  );
  const window = new BrowserWindow({
    show: false,
    webPreferences: { partition: PRINT_PARTITION, javascript: false, sandbox: true },
  });
  try {
    await window.loadFile(file);
    return await window.webContents.printToPDF({ printBackground: true, preferCSSPageSize: true });
  } finally {
    window.destroy();
    await rm(directory, { recursive: true, force: true });
  }
}

export async function exportNoteDocument(request: ExportRequest): Promise<string | null> {
  const target = await hostPorts().desktop.pickSavePath(hostPorts().workspaceClient(), {
    title: request.format === 'pdf' ? '下载 PDF' : '下载 Word',
    defaultPath: `${request.title}.${request.format}`,
    extension: request.format,
  });
  if (!target) return null;
  await writeFile(target, request.format === 'pdf' ? await printPdf(request.html) : request.bytes);
  hostPorts().desktop.reveal(target);
  return target;
}
