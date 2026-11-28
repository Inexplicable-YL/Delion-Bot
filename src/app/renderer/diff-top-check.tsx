import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { reviewTabId } from '../../modules/chat/view/review/tab-id';
import './styles/globals.css';

const projectId = '0197d5a2-7b1e-7cc2-9f3a-5e6d1c2b3a4d';
const path = 'src/example.ts';
const before = 'const first = "before ' + 'long '.repeat(60) + '";\n' + 'const unchanged = 1;\n'.repeat(80);
const after = before.replace('before', 'after').replace(/long long /, 'long long '.repeat(9));
const patch = `--- a/${path}\n+++ b/${path}\n@@ -1,4 +1,4 @@\n-${before.split('\n')[0]}\n+${after.split('\n')[0]}\n` + ' const unchanged = 1;\n'.repeat(3);
Object.assign(window, {
  delionBot: { bridge: { invoke: async () => ({ path, before, after, patch, status: 'modified', note: null }), subscribe: () => {} } },
});
const root = createRoot(document.getElementById('root')!);
Object.assign(window, {
  toggleWrap: async () => {
    const { useEditorSettings } = await import('../../modules/preview/view/editor-settings');
    useEditorSettings.getState().toggleWordWrap();
  },
});
const mode = new URLSearchParams(location.search).get('view');
if (mode === 'preview') {
  const { CodeViewer } = await import('../../modules/preview/view/CodeViewer');
  root.render(
    <main data-code-scroll-surface="" className="fixed inset-0 flex flex-col bg-page">
      <div className="h-row-regular">Preview toolbar</div>
      <CodeViewer value={after} filename={path} initialScroll={() => 0} onScroll={() => {}} />
    </main>,
  );
} else if (mode === 'note') {
  const { MarkdownEditor } = await import('../../modules/note/view/MarkdownEditor');
  root.render(
    <main className="fixed inset-0 flex flex-col bg-page">
      <MarkdownEditor value={after} filename={path} onChange={() => {}} onSave={() => {}} onScroll={() => {}} />
    </main>,
  );
} else {
const { ReviewTab } = await import('../../modules/chat/view/review/ReviewTab');
root.render(
  <QueryClientProvider client={new QueryClient()}>
    <main data-workbench-surface="surface" className="fixed inset-0 flex flex-col bg-surface text-ink">
      <ReviewTab tabId={reviewTabId({ kind: 'uncommitted', projectId, path })} groupId="primary" />
    </main>
  </QueryClientProvider>
);
}
