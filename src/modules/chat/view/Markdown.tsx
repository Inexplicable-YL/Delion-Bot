import 'katex/dist/katex.min.css';

import { createContext, use, type ComponentProps, type ReactNode } from 'react';
import { code } from '@streamdown/code';
import { createMathPlugin } from '@streamdown/math';
import type { MermaidConfig } from '@streamdown/mermaid';
import {
  Streamdown,
  defaultRemarkPlugins,
  defaultTranslations,
  type Components,
  type ControlsConfig,
  type DiagramPlugin,
  type LinkSafetyConfig,
} from 'streamdown';
import { cn } from '../../../ui/cn';
import { FileIcon } from '../../../ui/FileIcon';
import { mermaidConfig, renderMermaid } from '../../preview/view';
import { useChatTabSource } from './ChatSource';
import type { ChatReference } from './drafts';
import { matchReferenceTokens } from './reference-tokens';
import { ReplyImages } from './ReplyImage';
import { useReplyImageContext } from './ReplyImageContext';
import type { ReplyImageItem } from './reply-images';

const lazyMermaidPlugin: DiagramPlugin = {
  name: 'mermaid',
  type: 'diagram',
  language: 'mermaid',
  getMermaid: (config?: MermaidConfig) => ({
    initialize: () => {},
    render: (id: string, chart: string) => renderMermaid(id, chart, config),
  }),
};

const chatStreamdownPlugins = {
  code,
  math: createMathPlugin({ singleDollarTextMath: true }),
  mermaid: lazyMermaidPlugin,
};

const chatControls: ControlsConfig = {
  code: { copy: true, download: false },
  table: false,
  mermaid: { copy: false, download: false },
  image: false,
};

let mermaidWrapper: { config: MermaidConfig; options: { config: MermaidConfig } } | null = null;
function mermaidOptions() {
  const config = mermaidConfig();
  if (mermaidWrapper?.config !== config) mermaidWrapper = { config, options: { config } };
  return mermaidWrapper.options;
}

const chatTranslations = {
  ...defaultTranslations,
  copyCode: '复制代码',
  copied: '已复制',
  viewFullscreen: '全屏查看',
  exitFullscreen: '退出全屏',
  zoomIn: '放大',
  zoomOut: '缩小',
  resetView: '重置视图',
};

function ChatTable({
  children,
  className,
  node: _node,
  ...props
}: ComponentProps<'table'> & { node?: unknown }) {
  return (
    <div className="my-2 w-full overflow-x-auto">
      <table className={cn('w-full text-ui-subhead', className)} {...props}>
        {children}
      </table>
    </div>
  );
}

const chatComponents = { table: ChatTable };

type MarkdownNode = {
  type: string;
  value?: string;
  url?: string;
  alt?: string | null;
  children?: MarkdownNode[];
  data?: Record<string, unknown>;
};

const unsupportedImageUrl = /^(?:data|blob):/i;
const webImageUrl = /^https?:/i;

function decodedImagePath(url: string): string {
  try {
    return decodeURI(url);
  } catch {
    return url;
  }
}

const unparsedImage = /!\[([^\]\n]*)\]\(([^()\n]+?\.(?:png|jpe?g|gif|webp|bmp|svg))\)/gi;

function splitUnparsedImages(node: MarkdownNode): MarkdownNode[] {
  if (node.type !== 'text' || !node.value?.includes('![')) return [node];
  const parts: MarkdownNode[] = [];
  let last = 0;
  for (const match of node.value.matchAll(unparsedImage)) {
    if (match.index > last)
      parts.push({ type: 'text', value: node.value.slice(last, match.index) });
    parts.push({ type: 'image', alt: match[1], url: match[2]!.trim() });
    last = match.index + match[0].length;
  }
  if (!parts.length) return [node];
  if (last < node.value.length) parts.push({ type: 'text', value: node.value.slice(last) });
  return parts;
}

function replyImageItem(node: MarkdownNode): ReplyImageItem | null {
  if (node.type !== 'image' || !node.url || unsupportedImageUrl.test(node.url)) return null;
  const alt = node.alt ?? '';
  return webImageUrl.test(node.url)
    ? { url: node.url, alt }
    : { path: decodedImagePath(node.url), alt };
}

function imagesNode(images: ReplyImageItem[]): MarkdownNode {
  return {
    type: 'image',
    url: '',
    data: { hName: 'reply-images', hProperties: { images: JSON.stringify(images) } },
  };
}

const isGap = (node: MarkdownNode) =>
  node.type === 'break' || (node.type === 'text' && !node.value?.trim());

function groupReplyImages(children: MarkdownNode[]): MarkdownNode[] {
  const grouped: MarkdownNode[] = [];
  let run: ReplyImageItem[] = [];
  let gaps: MarkdownNode[] = [];
  const flush = () => {
    if (run.length) grouped.push(imagesNode(run));
    grouped.push(...gaps);
    run = [];
    gaps = [];
  };
  for (const child of children) {
    const item = replyImageItem(child);
    if (item) {
      gaps = [];
      run.push(item);
    } else if (run.length && isGap(child)) gaps.push(child);
    else {
      flush();
      grouped.push(child);
    }
  }
  flush();
  return grouped;
}

function markReplyImages(node: MarkdownNode): void {
  if (!node.children) return;
  node.children = groupReplyImages(node.children.flatMap(splitUnparsedImages));
  node.children.forEach(markReplyImages);
}

const replyImageTags = { 'reply-images': ['images'] };

function ReplyImagesTag({ images }: { images?: string }) {
  return images ? <ReplyImages images={JSON.parse(images) as ReplyImageItem[]} /> : null;
}

const replyComponents = { ...chatComponents, 'reply-images': ReplyImagesTag } as Components;

function splitReferences(node: MarkdownNode, options: ChatReference[]): MarkdownNode[] {
  if (node.type !== 'text' || !node.value) return [node];
  const value = node.value;
  const parts: MarkdownNode[] = [];
  let last = 0;
  for (const { start, end, ref } of matchReferenceTokens(value, options)) {
    if (start > last) parts.push({ type: 'text', value: value.slice(last, start) });
    parts.push({
      type: 'emphasis',
      children: [{ type: 'text', value: value.slice(start, end) }],
      data: { hName: 'chat-reference', hProperties: { path: ref.key } },
    });
    last = end;
  }
  if (!parts.length) return [node];
  if (last < value.length) parts.push({ type: 'text', value: value.slice(last) });
  return parts;
}

const localFileUrl = /^(?:[a-z]:[\\/]|(?![#?]|\/\/)[^:]+$)/i;

function markReferences(node: MarkdownNode, options: ChatReference[]): void {
  if (node.type === 'link') {
    if (node.url && localFileUrl.test(node.url))
      node.data = { hName: 'chat-file-link', hProperties: { path: decodedImagePath(node.url) } };
    return;
  }
  if (!node.children) return;
  node.children = node.children.flatMap((child) => {
    markReferences(child, options);
    return splitReferences(child, options);
  });
}

const referenceTags = { 'chat-reference': ['path'], 'chat-file-link': ['path'] };

const OpenReferenceContext = createContext<(key: string) => void>(() => {});

function FileReference({
  path,
  underline,
  children,
}: {
  path: string;
  underline: boolean;
  children?: ReactNode;
}) {
  const open = use(OpenReferenceContext);
  const label = children ?? path.slice(Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')) + 1);
  const [lead, ...rest] = typeof label === 'string' ? Array.from(label) : [label];
  return (
    <span
      className={cn(
        'cursor-pointer font-semibold text-accent-ink',
        underline && 'border-b border-current',
      )}
      onClick={() => open(path)}
      onKeyDown={(event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        open(path);
      }}
      role="button"
      tabIndex={0}
      title={path}
    >
      <span className="whitespace-nowrap">
        <FileIcon className="mr-1 inline size-4 align-text-bottom text-accent-ink" path={path} />
        {lead}
      </span>
      {rest.join('')}
    </span>
  );
}

const referenceComponents = {
  'chat-reference': ({ path }: { path: string }) => <FileReference path={path} underline={false} />,
  'chat-file-link': ({ path, children }: { path: string; children?: ReactNode }) => (
    <FileReference path={path} underline>
      {children}
    </FileReference>
  ),
};

const markdownStyles =
  '[&_p]:my-2 [&_p:first-child]:mt-0 [&_p:last-child]:mb-0 [&_li]:my-1 [&_h1]:mt-4 [&_h1]:mb-2 [&_h1]:text-ui-title-3 [&_h1]:font-semibold [&_h2]:mt-4 [&_h2]:mb-2 [&_h2]:text-ui-headline [&_h3]:mt-3 [&_h3]:mb-1 [&_h3]:text-ui-headline [&_blockquote]:border-l-2 [&_blockquote]:border-line [&_blockquote]:pl-3 [&_blockquote]:text-ink-2 [&_th]:border [&_th]:px-2 [&_th]:py-1 [&_th]:text-left [&_td]:border [&_td]:px-2 [&_td]:py-1 [&_code]:rounded [&_code]:bg-code [&_code]:px-1 [&_code]:py-0.5 [&_:not(pre)>code]:text-ui-callout [&_pre]:my-2 [&_pre]:rounded-control [&_pre]:bg-code [&_pre]:p-3 [&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_.katex-display]:overflow-x-auto [&_.katex-display]:overflow-y-hidden [&_[data-streamdown=code-block]]:gap-0 [&_[data-streamdown=code-block]]:rounded-card [&_[data-streamdown=code-block]]:border-0 [&_[data-streamdown=code-block]]:bg-code [&_[data-streamdown=code-block]]:p-0 [&_[data-streamdown=code-block-header]]:sticky [&_[data-streamdown=code-block-header]]:top-0 [&_[data-streamdown=code-block-header]]:z-10 [&_[data-streamdown=code-block-header]]:justify-start [&_[data-streamdown=code-block-header]]:rounded-t-card [&_[data-streamdown=code-block-header]]:bg-code [&_[data-streamdown=code-block-header]]:px-2 [&_[data-streamdown=code-block]>div:nth-child(2)]:-mt-8 [&_[data-streamdown=code-block]>div:nth-child(2)]:pr-3 [&_[data-streamdown=code-block]>div:nth-child(2)]:top-0 [&_[data-streamdown=code-block-body]]:rounded-none [&_[data-streamdown=code-block-body]]:border-none [&_[data-streamdown=code-block-body]]:bg-transparent [&_[data-streamdown=code-block-body]]:p-0 [&_[data-streamdown=code-block-body]_pre]:my-0 [&_[data-streamdown=code-block-body]_pre]:rounded-none [&_[data-streamdown=code-block-body]_pre]:rounded-b-card [&_[data-streamdown=code-block-actions]]:opacity-0 [&_[data-streamdown=code-block-actions]]:transition-opacity [&_[data-streamdown=code-block]:focus-within_[data-streamdown=code-block-actions]]:opacity-100 [&_[data-streamdown=code-block]:hover_[data-streamdown=code-block-actions]]:opacity-100 [&_div[data-streamdown=code-block-actions]]:border-0 [&_div[data-streamdown=code-block-actions]]:bg-transparent [&_div[data-streamdown=code-block-actions]]:p-0 [&_div[data-streamdown=code-block-actions]_button[data-streamdown=code-block-copy-button]]:rounded-control [&_div[data-streamdown=code-block-actions]_button[data-streamdown=code-block-copy-button]_svg]:size-3.5 [&_div[data-streamdown=code-block-actions]_button[data-streamdown=code-block-copy-button]:hover]:bg-hover-strong [&_[data-streamdown=unordered-list]]:list-outside [&_[data-streamdown=unordered-list]]:pl-5 [&_[data-streamdown=ordered-list]]:list-outside [&_[data-streamdown=ordered-list]]:pl-5 [&_[data-streamdown=code-block-header]_span:empty::after]:content-["txt"]';

export function ChatMarkdown({
  children,
  className,
  mode = 'static',
  replyImages = false,
  references,
  ...props
}: ComponentProps<typeof Streamdown> & {
  replyImages?: boolean;
  references?: { options?: ChatReference[]; onOpen: (key: string) => void };
}) {
  const { opensLink } = useChatTabSource();
  const linkSafety: LinkSafetyConfig = { enabled: true, onLinkCheck: opensLink };
  const reply = useReplyImageContext();
  const images = replyImages && reply !== null;
  const remarkPlugins = [
    ...(images ? [() => markReplyImages] : []),
    ...(references
      ? [() => (tree: MarkdownNode) => markReferences(tree, references.options ?? [])]
      : []),
  ];
  const allowedTags = {
    ...(images ? replyImageTags : {}),
    ...(references ? referenceTags : {}),
  };
  const components = {
    ...(images ? replyComponents : chatComponents),
    ...(references ? referenceComponents : {}),
  } as Components;
  return (
    <OpenReferenceContext value={references?.onOpen ?? (() => {})}>
      <Streamdown
        allowedTags={Object.keys(allowedTags).length ? allowedTags : undefined}
        className={cn(markdownStyles, className)}
        codeBlockMaxHeight={0}
        components={components}
        controls={chatControls}
        linkSafety={linkSafety}
        mermaid={mermaidOptions()}
        mode={mode}
        plugins={chatStreamdownPlugins}
        remarkPlugins={
          remarkPlugins.length
            ? [...Object.values(defaultRemarkPlugins), ...remarkPlugins]
            : undefined
        }
        skipHtml
        translations={chatTranslations}
        {...props}
      >
        {children}
      </Streamdown>
    </OpenReferenceContext>
  );
}
