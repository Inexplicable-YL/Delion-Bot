import { useState, useSyncExternalStore, type CSSProperties, type RefObject } from 'react';
import { countColumn } from '@codemirror/state';
import {
  DEFAULT_VIRTUAL_FILE_METRICS,
  DIFFS_TAG_NAME,
  getSingularPatch,
  hydratePartialDiff,
  parseDiffFromFile,
  registerCustomTheme,
  type FileContents,
  type FileDiffOptions,
} from '@pierre/diffs';
import { File, FileDiff, useVirtualizer, Virtualizer } from '@pierre/diffs/react';
import { ToolCard } from '../../../../ui/agent/ToolCard';
import { FileIcon } from '../../../../ui/FileIcon';
import { useRootFontSize } from '../../../../ui/root-font-size';
import { codeLayout, useEditorSettings } from '../../../preview/view';
import { ReviewDiffRenderer } from './review-diff-renderer';

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
  '--diffs-font-size': `${codeLayout.fontSize}rem`,
  '--diffs-line-height': `calc(var(--diffs-font-size) * ${codeLayout.lineHeight})`,
  '--diffs-tab-size': codeLayout.tabSize,
  '--diffs-gap-style': 'none',
  '--diffs-fg-number-addition-override': 'var(--ink-3)',
  '--diffs-fg-number-deletion-override': 'var(--ink-3)',
  '--diffs-bg-context-override': 'transparent',
  '--diffs-bg-context-gutter-override': 'transparent',
  '--diffs-bg-separator-override': 'var(--field)',
  '--diffs-bg-buffer-override': 'var(--line-strong)',
  '--diffs-bg-addition-emphasis-override': 'var(--diff-added-word)',
  '--diffs-bg-deletion-emphasis-override': 'var(--diff-removed-word)',
  '--diffs-gap-inline': `${codeLayout.inset}rem`,
  '--diffs-scrollbar-gutter-override': 'var(--scrollbar-size)',
} as CSSProperties;

const reviewTheme = 'delion-source';
registerCustomTheme(reviewTheme, async () => ({
  name: reviewTheme,
  type: 'dark',
  colors: { 'editor.foreground': 'var(--ink)', 'editor.background': 'transparent' },
  settings: [
    { scope: ['comment'], settings: { foreground: 'var(--syntax-comment)' } },
    { scope: ['keyword', 'storage'], settings: { foreground: 'var(--syntax-keyword)' } },
    { scope: ['keyword.operator'], settings: { foreground: 'var(--syntax-operator)' } },
    { scope: ['string'], settings: { foreground: 'var(--syntax-string)' } },
    {
      scope: ['string.regexp', 'constant.character.escape'],
      settings: { foreground: 'var(--syntax-regexp)' },
    },
    {
      scope: ['constant', 'variable.language'],
      settings: { foreground: 'var(--syntax-constant)' },
    },
    {
      scope: ['entity.name.function', 'support.function'],
      settings: { foreground: 'var(--syntax-function)' },
    },
    {
      scope: ['entity.name.type', 'support.type', 'support.class'],
      settings: { foreground: 'var(--syntax-entity)' },
    },
    { scope: ['entity.name.tag'], settings: { foreground: 'var(--syntax-tag)' } },
    {
      scope: ['support.type.property-name', 'variable.object.property'],
      settings: { foreground: 'var(--syntax-markup)' },
    },
    {
      scope: ['punctuation.separator', 'punctuation.terminator'],
      settings: { foreground: 'color-mix(in srgb, var(--syntax-fg) 70%, transparent)' },
    },
    { scope: ['punctuation.accessor'], settings: { foreground: 'var(--syntax-operator)' } },
    { scope: ['invalid'], settings: { foreground: 'var(--syntax-error)' } },
  ],
}));

const reviewStyles = `
  [data-diff-type=split][data-overflow=scroll] {
    grid-template-columns: minmax(0, var(--review-split)) minmax(0, 1fr);
  }
  [data-diff-type=split][data-overflow=wrap] {
    grid-template-columns: minmax(min-content, max-content)
      minmax(0, calc(var(--review-split) - var(--review-old-gutter, 0px)))
      minmax(min-content, max-content) minmax(0, 1fr);
  }
  [data-column-number] {
    box-sizing: border-box;
    min-width: calc(${codeLayout.inset}rem + ${codeLayout.lineNumberWidth});
    padding-inline-start: calc(${codeLayout.inset + codeLayout.lineNumberPaddingStart}rem - 1ch);
    padding-inline-end: calc(${codeLayout.lineNumberPaddingEnd}rem + 1ch);
  }
  [data-line-number-content] {
    min-width: var(--diffs-min-number-column-width-default);
  }
  [data-line], [data-no-newline] {
    padding-inline: 0 ${codeLayout.inset}rem;
  }
  [data-line][data-line-type=change-addition] {
    background-color: var(--diff-added-line);
  }
  [data-line][data-line-type=change-deletion] {
    background-color: var(--diff-removed-line);
  }
  [data-line][data-line-type=context-expanded] {
    background-color: var(--field);
  }
  [data-column-number] {
    background-color: transparent;
  }
  [data-column-number][data-line-type^=change-]::after {
    position: absolute;
    inset-inline-end: 0;
    inset-block-start: 0;
    width: calc(${codeLayout.lineNumberPaddingEnd}rem + 1ch);
    text-align: center;
    font: inherit;
  }
  [data-column-number][data-line-type=change-addition]::after {
    content: "+";
    color: var(--success);
  }
  [data-column-number][data-line-type=change-deletion]::after {
    content: "−";
    color: var(--danger);
  }
  [data-column-number][data-selected-line] {
    color: var(--accent-ink);
    box-shadow: inset 2px 0 var(--accent-ink);
  }
  [data-separator=line-info-basic] {
    height: var(--diffs-line-height);
    background: var(--diffs-bg-separator);
  }
  [data-separator=line-info-basic] [data-separator-wrapper] {
    display: block;
    background: transparent;
  }
  [data-separator=line-info-basic] [data-expand-button] {
    display: none;
  }
  [data-separator=line-info-basic] [data-separator-content] {
    padding: 0;
    background: transparent;
    color: var(--ink);
    font-size: var(--diffs-font-size);
    line-height: var(--diffs-line-height);
  }
  [data-review-fold-label] {
    cursor: pointer;
  }
  [data-review-fold-label]:hover {
    background: var(--hover);
  }
  [data-review-fold] {
    display: grid;
    place-items: center;
    height: 100%;
    width: 100%;
    padding: 0;
    color: var(--ink-2);
    background: transparent;
    border: 0;
    border-radius: var(--radius-control);
    cursor: pointer;
  }
  [data-review-fold]:hover {
    background: var(--hover);
    color: var(--ink);
  }
  [data-review-fold]:focus-visible {
    outline: none;
    box-shadow: inset 0 0 0 1px var(--accent-ink);
  }
  [data-review-fold] svg {
    width: calc(var(--spacing) * 4);
    height: calc(var(--spacing) * 4);
    fill: currentColor;
    flex-shrink: 0;
  }
  [data-column-number] [data-review-fold] {
    position: absolute;
    inset-block-start: 0;
    inset-inline-start: 0;
    width: calc(var(--spacing) * 5);
  }
  [data-line][style*="--indent-guide-width"] {
    background-image: repeating-linear-gradient(to right, ${codeLayout.indentGuideColor} 0 1px, transparent 1px ${codeLayout.indentWidth}ch);
    background-size: var(--indent-guide-width) 100%;
    background-repeat: no-repeat;
  }
  [data-code] {
    scrollbar-width: auto;
    scrollbar-color: auto;
  }
  [data-code]::-webkit-scrollbar-thumb {
    border: var(--scrollbar-thumb-inset) solid transparent;
    border-radius: var(--radius-pill);
    background: var(--scrollbar-thumb);
    background-clip: padding-box;
  }
  [data-code]::-webkit-scrollbar-thumb:hover {
    background-color: var(--scrollbar-thumb-hover);
  }
`;

function contextButton(
  label: string,
  index: number,
  expanded: boolean,
  onToggle: (index: number, control: HTMLButtonElement) => void,
) {
  const button = document.createElement('button');
  button.type = 'button';
  button.dataset.reviewFold = String(index);
  button.setAttribute('aria-expanded', String(expanded));
  button.setAttribute('aria-label', label);
  button.title = label;
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  const icon = document.createElementNS('http://www.w3.org/2000/svg', 'use');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('viewBox', '0 0 16 16');
  icon.setAttribute('href', expanded ? '#diffs-icon-expand' : '#diffs-icon-expand-all');
  svg.append(icon);
  if (expanded) {
    icon.setAttribute('y', '-4');
    const lower = icon.cloneNode() as SVGUseElement;
    lower.removeAttribute('y');
    lower.setAttribute('transform', 'translate(0 20) scale(1 -1)');
    svg.append(lower);
  }
  button.append(svg);
  button.onclick = (event) => {
    event.stopPropagation();
    onToggle(index, button);
  };
  return button;
}

function indentColumns(line: string) {
  const leading = /^[ \t\u00a0]*/.exec(line)![0];
  const columns = countColumn(leading, codeLayout.tabSize);
  return columns - (columns % codeLayout.indentWidth);
}

function indentsOf(text: string | null) {
  if (text === null) return null;
  const lines = text.split(/\r\n?|\n/);
  const indents: number[] = [];
  let previous = 0;
  let firstBlank = 0;
  for (const [index, line] of lines.entries()) {
    if (!line.trim()) continue;
    const indent = indentColumns(line);
    const blankIndent = Math.min(Math.max(previous, indent), previous + codeLayout.indentWidth);
    for (let blank = Math.max(firstBlank, 1); blank < index; blank++) indents[blank] = blankIndent;
    indents[index] = indent;
    previous = indent;
    firstBlank = index + 1;
  }
  for (let blank = Math.max(firstBlank, 1); blank < lines.length; blank++)
    indents[blank] = previous;
  return indents;
}

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
  oldFile,
  newFile,
  rendererRef,
  onContextExpansionChange,
}: {
  patch: string;
  diffStyle: 'unified' | 'split';
  oldFile: FileContents | null;
  newFile: FileContents | null;
  rendererRef: RefObject<ReviewDiffRenderer | null>;
  onContextExpansionChange: (expanded: boolean) => void;
}) {
  const virtualizer = useVirtualizer()!;
  const themeType = useAppThemeType();
  const wordWrap = useEditorSettings((state) => state.wordWrap);
  const rootSize = useRootFontSize();
  const inset = codeLayout.inset * rootSize + codeLayout.contentBlockPadding;
  const beforeIndents = indentsOf(oldFile?.contents ?? null);
  const afterIndents = indentsOf(newFile?.contents ?? null);
  const parsed = getSingularPatch(patch);
  const fileDiff =
    oldFile &&
    newFile &&
    parsed.isPartial &&
    (parsed.type === 'change' || parsed.type === 'rename-changed')
      ? hydratePartialDiff('clone', parsed, { oldFile, newFile })
      : parsed;
  const lineHeight = codeLayout.fontSize * rootSize * codeLayout.lineHeight;
  const metrics = {
    ...DEFAULT_VIRTUAL_FILE_METRICS,
    lineHeight,
    hunkSeparatorHeight: lineHeight,
    paddingTop: inset,
    paddingBottom: inset,
  };
  const options: FileDiffOptions<undefined, undefined> = {
    ...baseOptions,
    theme: reviewTheme,
    themeType,
    diffStyle,
    overflow: wordWrap ? 'wrap' : 'scroll',
    diffIndicators: 'none',
    hunkSeparators: 'line-info-basic',
    collapsedContextThreshold: 0,
    unsafeCSS: reviewStyles,
    onPostRender: (container, renderer, phase) => {
      const root = container.shadowRoot;
      if (phase === 'unmount' || !root || !(renderer instanceof ReviewDiffRenderer)) return;

      if (wordWrap && diffStyle === 'split') {
        const gutter = root.querySelector('[data-deletions] [data-gutter]');
        if (gutter)
          container.style.setProperty(
            '--review-old-gutter',
            `${gutter.getBoundingClientRect().width}px`,
          );
      }
      const toggle = (index: number, control: HTMLButtonElement) =>
        onContextExpansionChange(renderer.toggleContext(index, control));
      for (const label of root.querySelectorAll<HTMLElement>('[data-unmodified-lines]')) {
        const count = label.textContent.match(/^\d+/)?.[0];
        if (!count) continue;
        const text = `${count} 个隐藏的行`;
        const index = label.closest<HTMLElement>('[data-separator]')?.dataset.expandIndex;
        if (label.closest('[data-gutter]')) {
          if (index === undefined) label.remove();
          else label.replaceWith(contextButton(`展开 ${text}`, Number(index), false, toggle));
        } else {
          label.textContent = text;
          if (index === undefined) continue;
          const content = label.parentElement!;
          content.dataset.reviewFoldLabel = '';
          content.onclick = (event) => {
            event.stopPropagation();
            content
              .closest('code')
              ?.querySelector<HTMLButtonElement>(`[data-gutter] [data-review-fold="${index}"]`)
              ?.click();
          };
        }
      }

      const oldStarts = new Map<number, number>();
      const newStarts = new Map<number, number>();
      for (const region of renderer.contextRegions) {
        if (!renderer.isContextExpanded(region.index)) continue;
        oldStarts.set(region.oldStart, region.index);
        newStarts.set(region.newStart, region.index);
      }
      for (const number of root.querySelectorAll<HTMLElement>(
        '[data-column-number][data-line-type=context-expanded]',
      )) {
        const starts = number.closest('[data-deletions]') ? oldStarts : newStarts;
        const index = starts.get(Number(number.dataset.columnNumber));
        if (index !== undefined && !number.querySelector('[data-review-fold]'))
          number.append(contextButton('收起这段未修改的代码', index, true, toggle));
      }
      for (const line of root.querySelectorAll<HTMLElement>('[data-content] [data-line]')) {
        const indents =
          line.dataset.lineType === 'change-deletion' || line.closest('[data-deletions]')
            ? beforeIndents
            : afterIndents;
        const columns = indents?.[Number(line.dataset.line) - 1] ?? indentColumns(line.textContent);
        if (columns > 0) line.style.setProperty('--indent-guide-width', `calc(${columns}ch - 1px)`);
        else line.style.removeProperty('--indent-guide-width');
      }
    },
  };
  const [mountDiff] = useState(() => (node: HTMLDivElement | null) => {
    if (!node) return;
    const renderer = new ReviewDiffRenderer(options, virtualizer, metrics);
    const container = document.createElement(DIFFS_TAG_NAME);
    container.style.display = 'block';
    container.style.minHeight = '1px';
    rendererRef.current = renderer;
    node.append(container);
    renderer.hydrate({ fileDiff, fileContainer: container });
    return () => {
      renderer.cleanUp();
      rendererRef.current = null;
      container.remove();
    };
  });
  const syncDiff = (node: HTMLDivElement | null) => {
    const renderer = rendererRef.current;
    if (!node || !renderer) return;
    renderer.setMetrics(metrics);
    renderer.setOptions(options);
    renderer.render({ fileDiff });
  };
  return (
    <div
      ref={syncDiff}
      style={{ ...reviewTokenStyle, '--diffs-gap-block': `${inset}px` } as CSSProperties}
    >
      <div ref={mountDiff} />
    </div>
  );
}

export function DiffScroller({ children }: { children: React.ReactNode }) {
  return (
    <Virtualizer className="min-h-0 min-w-0 flex-1 overflow-auto [overflow-anchor:none] [scrollbar-gutter:stable]">
      {children}
    </Virtualizer>
  );
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
