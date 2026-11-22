import { useSyncExternalStore, type CSSProperties } from 'react';
import { parseDiffFromFile, type FileDiffLoadedChangedFiles } from '@pierre/diffs';
import { File, FileDiff, PatchDiff, Virtualizer } from '@pierre/diffs/react';
import { ToolCard } from '../../../../ui/agent/ToolCard';
import { FileIcon } from '../../../../ui/FileIcon';

const tokenStyle = {
  '--diffs-font-family': 'var(--font-mono)',
  '--diffs-header-font-family': 'var(--font-sans)',
  '--diffs-font-size': 'var(--text-ui-callout)',
  '--diffs-line-height': 'calc(var(--spacing) * 5)',
  '--diffs-addition-color-override': 'var(--success)',
  '--diffs-deletion-color-override': 'var(--danger)',
  '--diffs-bg-addition-override': 'var(--success-tint)',
  '--diffs-bg-deletion-override': 'var(--danger-tint)',
  '--diffs-bg-addition-emphasis-override': 'color-mix(in srgb, var(--success) 28%, transparent)',
  '--diffs-bg-deletion-emphasis-override': 'color-mix(in srgb, var(--danger) 28%, transparent)',
  '--diffs-fg-number-override': 'var(--ink-3)',
} as CSSProperties;

const reviewTokenStyle = {
  ...tokenStyle,
  '--diffs-font-size': 'var(--text-ui-body)',
  '--diffs-line-height': 'calc(var(--spacing) * 6)',
} as CSSProperties;

const baseOptions = {
  diffStyle: 'unified',
  lineDiffType: 'word',
  disableFileHeader: true,
  theme: { light: 'github-light', dark: 'github-dark' },
} as const;

function subscribeRootClass(onChange: () => void) {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
  return () => observer.disconnect();
}

function useAppThemeType() {
  return useSyncExternalStore(subscribeRootClass, () =>
    document.documentElement.classList.contains('dark') ? 'dark' : 'light',
  );
}

export function PatchDiffView({
  patch,
  diffStyle,
  files,
  expandUnchanged,
}: {
  patch: string;
  diffStyle: 'unified' | 'split';
  files: FileDiffLoadedChangedFiles | null;
  expandUnchanged: boolean;
}) {
  const themeType = useAppThemeType();
  return (
    <PatchDiff
      className="bg-surface"
      options={{
        ...baseOptions,
        themeType,
        diffStyle,
        expandUnchanged: files !== null && expandUnchanged,
        loadDiffFiles: files ? async () => files : undefined,
      }}
      patch={patch}
      style={reviewTokenStyle}
    />
  );
}

export function DiffScroller({ children }: { children: React.ReactNode }) {
  return <Virtualizer className="min-h-0 min-w-0 flex-1 overflow-auto">{children}</Virtualizer>;
}

const withFinalNewline = (text: string) => (text && !text.endsWith('\n') ? `${text}\n` : text);

export function CodeFileCard({
  path,
  content,
  failed,
}: {
  path: string;
  content: string;
  failed: boolean;
}) {
  const themeType = useAppThemeType();
  return (
    <ToolCard
      bodyClassName="max-h-80 overflow-y-auto"
      copyText={content}
      failed={failed}
      icon={<FileIcon path={path} />}
      title={path}
    >
      <File
        className="bg-surface"
        file={{ name: path, contents: withFinalNewline(content) }}
        options={{ disableFileHeader: true, overflow: 'wrap', theme: baseOptions.theme, themeType }}
        style={tokenStyle}
      />
    </ToolCard>
  );
}

export function EditDiffCard({
  path,
  oldText,
  newText,
  failed,
}: {
  path: string;
  oldText: string;
  newText: string;
  failed: boolean;
}) {
  const themeType = useAppThemeType();
  const fileDiff = parseDiffFromFile(
    { name: path, contents: withFinalNewline(oldText) },
    { name: path, contents: withFinalNewline(newText) },
  );
  const added = fileDiff.hunks.reduce((sum, hunk) => sum + hunk.additionLines, 0);
  const deleted = fileDiff.hunks.reduce((sum, hunk) => sum + hunk.deletionLines, 0);
  return (
    <ToolCard
      bodyClassName="max-h-80 overflow-y-auto"
      failed={failed}
      icon={<FileIcon path={path} />}
      stats={{ added, deleted }}
      title={path}
    >
      <FileDiff
        className="bg-surface"
        fileDiff={fileDiff}
        options={{ ...baseOptions, overflow: 'wrap', themeType }}
        style={tokenStyle}
      />
    </ToolCard>
  );
}
