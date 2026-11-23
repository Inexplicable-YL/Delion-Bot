import { lazy, Suspense } from 'react';
import { useQuery } from '@tanstack/react-query';

import { Button } from '../../../ui/Button';
import { Card } from '../../../ui/Card';
import { DocumentToolbar } from '../../../ui/DocumentToolbar';
import { useRootFontSize } from '../../../ui/root-font-size';
import { sanitizeHtml, sanitizeHtmlWithAssets } from './sanitize-html';
import { showToast } from '../../../ui/Toast';
import { parseRemoteNodeId, type TabId } from '../../workspace/contract';
import { useWorkspaceStore, workspaceClient, workspaceEntryPath } from '../../workspace/view';
import { CodeViewer } from './CodeViewer';
import { useContentLoader, type LoadedDocument } from './Loader';
import { OfficeExportBanner, OfficePromptCard } from './OfficePrompt';
import { previewScrollOf, rememberPreviewScroll, useHtmlPreviewModes } from './scroll-memory';
import { parsePreviewTabId } from './tab-id';
import { Spinner } from '../../../ui/Spinner';
import { errorMessage } from '../../../core/protocol/contract';
import { ImagePreview } from './ImagePreview';

const PdfReader = lazy(() =>
  import('./PdfReader').then((module) => ({ default: module.PdfReader })),
);
const DocxPreview = lazy(() =>
  import('./DocxPreview').then((module) => ({ default: module.DocxPreview })),
);
const SheetPreview = lazy(() =>
  import('./SheetPreview').then((module) => ({ default: module.SheetPreview })),
);
export type PreviewBranch =
  'source' | 'html' | 'pdf' | 'image' | 'docx' | 'xlsx' | 'pptx' | 'text' | 'binary';

function previewBranchOf(doc: LoadedDocument): PreviewBranch {
  if (doc.source) return 'source';
  const { format } = doc.content;
  if (
    format === 'html' ||
    format === 'pdf' ||
    format === 'image' ||
    format === 'docx' ||
    format === 'xlsx' ||
    format === 'pptx' ||
    format === 'binary'
  )
    return format;
  return 'text';
}

export function PreviewTab({ tabId, groupId }: { tabId: TabId; groupId: string }) {
  const loader = useContentLoader();
  const rootSize = useRootFontSize();
  const target = parsePreviewTabId(tabId);
  const entryId = target && 'entryId' in target ? target.entryId : null;
  const entries = useWorkspaceStore((state) => state.workspace.entries);
  const htmlMode = useHtmlPreviewModes((modes) => modes[tabId] ?? 'live');
  const query = useQuery({
    queryKey: ['preview', tabId, rootSize],
    queryFn: async () => {
      const doc = await loader.loadDocument(tabId);
      if (doc.content.format !== 'html' || doc.source) return { doc, html: '' };
      const readAsset = loader.readHtmlAsset;
      const html =
        target && 'entryId' in target && readAsset
          ? await sanitizeHtmlWithAssets(doc.content.text, rootSize, (path) =>
              readAsset(target.entryId, path),
            )
          : sanitizeHtml(doc.content.text, '', rootSize, 'auto');
      return { doc, html };
    },
    enabled: target !== null,
    gcTime: 0,
  });
  const doc = query.data?.doc;
  const error = query.isError && !doc && !query.isFetching ? errorMessage(query.error) : null;
  const scrollKey = `${tabId}:${groupId}`;
  const initialScroll = () => previewScrollOf(scrollKey);
  const onScroll = (top: number) => rememberPreviewScroll(scrollKey, top);
  const sourceScrollKey = `${scrollKey}:source`;

  const load = () =>
    void query.refetch().then((result) => {
      if (result.isError && result.data)
        showToast({
          variant: 'error',
          title: '重新读取文件失败',
          description: errorMessage(result.error),
        });
    });

  const watchesDisk = doc?.watchesDisk === true;
  const watchDisk = (element: HTMLElement | null) => {
    if (!element || !watchesDisk) return;
    const onFocus = () => load();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  };

  const content = doc?.content;
  if (!target)
    return (
      <div className="flex min-h-0 min-w-0 flex-1 items-center justify-center p-6 text-ui-body text-ink-2">
        无效的预览标签：{tabId}
      </div>
    );
  if (!doc || !content)
    return (
      <div className="flex min-h-0 min-w-0 flex-1 items-center justify-center p-6 text-ui-body text-ink-2">
        {error ? (
          <div role="alert" className="min-w-0">
            <p className="break-words">{error}</p>
            <Button variant="ghost" onClick={() => load()}>
              重试
            </Button>
          </div>
        ) : (
          <>
            <Spinner className="mr-2" />
            正在打开…
          </>
        )}
      </div>
    );

  const branch = previewBranchOf(doc);
  const path = branch === 'html' && entryId ? workspaceEntryPath(entries, entryId) : [];
  const openInFolder =
    entryId && !parseRemoteNodeId(entryId)
      ? () => {
          if (window.delionBot)
            void workspaceClient.openLocal(entryId).catch((cause) =>
              showToast({
                variant: 'error',
                title: '打开所在文件夹失败',
                description: errorMessage(cause),
              }),
            );
        }
      : undefined;
  const SourceDocument = doc.source?.document;
  const exported = content.office?.export;
  const bytes = content.bytes;
  const openLink = (url: string) => loader.openLink(url);
  const onOfficeRefresh = () => {
    load();
    loader.onExported?.(tabId);
  };

  return (
    <section
      ref={watchDisk}
      className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
      aria-label={`文档：${content.title}`}
    >
      {SourceDocument && (
        <SourceDocument
          content={content}
          navigate={loader.navigate}
          onReload={load}
          sourceId={doc.source!.id}
        />
      )}
      {branch === 'html' && (
        <DocumentToolbar
          path={path.length ? path : [content.title]}
          mode={htmlMode}
          onModeChange={(mode) => useHtmlPreviewModes.setState({ [tabId]: mode })}
          previewLabel="返回安全预览"
          onOpenInFolder={openInFolder}
          onReload={load}
        />
      )}
      {branch === 'html' && htmlMode === 'source' && (
        <CodeViewer
          value={content.text ?? ''}
          filename={content.title}
          initialScroll={() => previewScrollOf(sourceScrollKey)}
          onScroll={(top) => rememberPreviewScroll(sourceScrollKey, top)}
        />
      )}
      {branch === 'html' && htmlMode === 'live' && (
        <Card className="min-h-0 flex-1">
          <iframe
            title={content.title}
            className="size-full border-0 bg-paper"
            sandbox="allow-same-origin"
            referrerPolicy="no-referrer"
            srcDoc={query.data?.html}
            onLoad={(event) => {
              const frame = event.currentTarget;
              const frameDoc = frame.contentDocument;
              if (!frameDoc) return;
              frame.contentWindow?.scrollTo(0, initialScroll());
              frameDoc.addEventListener('click', (e) => {
                const target = (e.target as Element).closest?.('a[data-preview-href]');
                const href = target?.getAttribute('data-preview-href');
                if (href) {
                  e.preventDefault();
                  openLink(href);
                }
              });
              frame.contentWindow?.addEventListener('scroll', () =>
                onScroll(frame.contentWindow?.scrollY ?? 0),
              );
            }}
          />
        </Card>
      )}
      {branch === 'pdf' &&
        (content.previewUrl ? (
          <Suspense fallback={<p className="p-4 text-ui-body text-ink-2">正在加载阅读器…</p>}>
            <PdfReader
              key={content.previewUrl}
              url={content.previewUrl}
              initialScroll={initialScroll}
              onScroll={onScroll}
            />
          </Suspense>
        ) : (
          <p className="p-4 text-ui-body text-ink-2">正在准备预览…</p>
        ))}
      {branch === 'image' && bytes && (
        <ImagePreview
          key={tabId + ':' + (content.revision ?? '')}
          bytes={bytes}
          mime={content.mime}
          title={content.title}
        />
      )}
      {(branch === 'docx' || branch === 'xlsx') &&
        (content.previewUrl ? (
          <Suspense fallback={<p className="p-4 text-ui-body text-ink-2">正在加载预览…</p>}>
            {branch === 'docx' ? (
              <DocxPreview key={content.previewUrl} url={content.previewUrl} />
            ) : (
              <SheetPreview key={content.previewUrl} url={content.previewUrl} />
            )}
          </Suspense>
        ) : (
          <p className="p-4 text-ui-body text-ink-2">正在准备预览…</p>
        ))}
      {branch === 'pptx' && (
        <div className="flex min-h-0 flex-1 flex-col">
          {exported && (
            <OfficeExportBanner
              exported={exported}
              officeRef={doc.officeRef}
              onExported={onOfficeRefresh}
            />
          )}
          {exported?.previewUrl ? (
            <Suspense fallback={<p className="p-4 text-ui-body text-ink-2">正在加载阅读器…</p>}>
              <PdfReader
                key={exported.previewUrl}
                url={exported.previewUrl}
                initialScroll={initialScroll}
                onScroll={onScroll}
              />
            </Suspense>
          ) : (
            <OfficePromptCard
              title={content.title}
              officeRef={doc.officeRef}
              onExported={onOfficeRefresh}
            />
          )}
        </div>
      )}
      {branch === 'binary' && (
        <p className="p-6 text-ui-body text-ink-2">
          这个文件不是 UTF-8 文本或体积过大，无法内嵌预览，请下载文件或用默认程序打开。
        </p>
      )}
      {content.truncated && (branch === 'text' || branch === 'html') && (
        <p className="shrink-0 border-b px-4 py-2 text-ui-subhead text-ink-2">
          文件超过 1 MB，这里只显示开头部分。
        </p>
      )}
      {branch === 'text' && (
        <CodeViewer
          value={content.text ?? ''}
          filename={content.title}
          initialScroll={initialScroll}
          onScroll={onScroll}
        />
      )}
    </section>
  );
}
