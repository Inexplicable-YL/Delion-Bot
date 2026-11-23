import 'katex/dist/katex.min.css';

import { createContext, use, type ComponentProps, type ReactElement, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { FolderIcon } from '@heroicons/react/24/outline';
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
import { LibraryIcon } from '../../../ui/LibraryIcon';
import { ContextMenu, ContextMenuContent, ContextMenuTrigger } from '../../../ui/ContextMenu';
import { mermaidConfig, renderMermaid } from '../../preview/view';
import { useChatTabSource } from './ChatSource';
import type { ChatReference } from './drafts';
import { matchReferenceTokens } from './reference-tokens';
import { ReplyImages } from './ReplyImage';
import { useReplyImageContext } from './ReplyImageContext';
import type { ReplyImageItem } from './reply-images';
import { ReplyFileMenu } from './ReplyFileMenu';
import { WebLinkIcon } from './WebLinkIcon';
import { chatClient } from './client';
import { showToast } from '../../../ui/Toast';
import { errorMessage } from '../../../core/protocol/contract';
import { AskCard } from '../../../ui/agent/AskCard';
import {
  ASK_CARD_LANGUAGE,
  formatAskAnswer,
  parseAskAnswer,
  parseAskCard,
  type AskGroup,
} from './ask-card';

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
  close: '关闭',
  openExternalLink: '打开外部链接？',
  externalLinkWarning: '即将访问外部网站。',
  copyLink: '复制链接',
  openLink: '打开链接',
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
  lang?: string | null;
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

const webUrl = /^https?:\/\//i;

function markWebLink(node: MarkdownNode): void {
  const [first, ...rest] = node.children ?? [];
  const [lead = '', ...tail] = first?.type === 'text' ? Array.from(first.value ?? '') : [];
  node.children = [
    {
      type: 'emphasis',
      data: {
        hName: 'chat-web-link',
        hProperties: { bare: String(rest.length === 0 && first?.value === node.url) },
      },
      children: [
        {
          type: 'emphasis',
          children: lead ? [{ type: 'text', value: lead }] : [],
          data: { hName: 'chat-web-lead', hProperties: { url: node.url } },
        },
        ...(first?.type === 'text'
          ? [{ type: 'text', value: tail.join('') }]
          : first
            ? [first]
            : []),
        ...rest,
      ],
    },
  ];
}

function WebLink({ bare, children }: { bare?: string; children?: ReactNode }) {
  return (
    <span
      className={cn(
        'font-semibold text-accent-ink underline underline-offset-3',
        bare === 'true' && 'break-all',
      )}
      data-web-link
    >
      {children}
    </span>
  );
}

function WebLinkLead({ url, children }: { url: string; children?: ReactNode }) {
  return (
    <span className="whitespace-nowrap">
      <WebLinkIcon className="mr-0.5 ml-0.5 inline align-text-bottom text-accent-ink" url={url} />
      {children}
    </span>
  );
}

function markReferences(node: MarkdownNode, options: ChatReference[]): void {
  if (node.type === 'link') {
    if (node.url && localFileUrl.test(node.url))
      node.data = { hName: 'chat-file-link', hProperties: { path: decodedImagePath(node.url) } };
    else if (node.url && webUrl.test(node.url)) markWebLink(node);
    return;
  }
  if (!node.children) return;
  node.children = node.children.flatMap((child) => {
    markReferences(child, options);
    return splitReferences(child, options);
  });
}

const referenceTags = {
  'chat-reference': ['path'],
  'chat-file-link': ['path'],
  'chat-web-lead': ['url'],
  'chat-web-link': ['bare'],
};

type MarkdownReferences = {
  options?: ChatReference[];
  onOpen: (key: string) => void;
  fileMenu?: { sessionId: string; remote: boolean };
};

const ReferenceContext = createContext<MarkdownReferences | undefined>(undefined);

function FileReference({
  path,
  underline,
  children,
}: {
  path: string;
  underline: boolean;
  children?: ReactNode;
}) {
  const references = use(ReferenceContext);
  const menu = underline ? references?.fileMenu : undefined;
  const label = children ?? path.slice(Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')) + 1);
  const [lead, ...rest] = typeof label === 'string' ? Array.from(label) : [label];
  const open = (key = path) => references?.onOpen(key);
  const link = (activate: () => void, kind: 'file' | 'folder' | 'workspace' = 'file') => (
    <span
      className={cn(
        'cursor-pointer font-semibold text-accent-ink',
        underline && 'underline underline-offset-3',
      )}
      onClick={() => activate()}
      onKeyDown={(event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        activate();
      }}
      role="button"
      tabIndex={0}
      title={path}
    >
      <span className="whitespace-nowrap">
        {kind === 'workspace' ? (
          <LibraryIcon className="mr-0.5 ml-0.5 inline size-4 align-text-bottom" />
        ) : kind === 'folder' ? (
          <FolderIcon className="mr-0.5 ml-0.5 inline size-4 align-text-bottom" />
        ) : (
          <FileIcon
            className="mr-0.5 ml-0.5 inline size-4 align-text-bottom text-accent-ink"
            path={path}
          />
        )}
        {lead}
      </span>
      {rest.join('')}
    </span>
  );
  return menu ? (
    <ReplyReference {...menu} path={path} onOpenFile={open}>
      {link}
    </ReplyReference>
  ) : (
    link(open)
  );
}

function ReplyReference({
  path,
  sessionId,
  remote,
  onOpenFile,
  children,
}: NonNullable<MarkdownReferences['fileMenu']> & {
  path: string;
  onOpenFile: (key: string) => void;
  children: (open: () => void, kind: 'file' | 'folder' | 'workspace') => ReactElement;
}) {
  const { revealWorkspaceFolder } = useChatTabSource();
  const queryClient = useQueryClient();
  const file = { sessionId, path };
  const options = {
    queryKey: ['chat', 'reference-file-info', sessionId, path],
    queryFn: () => chatClient.referenceFileInfo(file).catch(() => null),
    staleTime: 30_000,
  };
  const { data: info } = useQuery(options);
  const directory = info?.directory ?? false;
  const open = async () => {
    const current = await queryClient.fetchQuery(options);
    if (!current?.directory) {
      onOpenFile(current?.path ?? path);
      return;
    }
    try {
      if (current.workspaceFolder) await revealWorkspaceFolder?.(current.path, sessionId);
      else await chatClient.openReferenceDirectory(file);
    } catch (cause) {
      showToast({ variant: 'error', title: '打开失败', description: errorMessage(cause) });
    }
  };
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        {children(
          () => void open(),
          info?.workspaceFolder ? 'workspace' : directory ? 'folder' : 'file',
        )}
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ReplyFileMenu directory={directory} path={path} remote={remote} sessionId={sessionId} />
      </ContextMenuContent>
    </ContextMenu>
  );
}

const referenceComponents = {
  'chat-reference': ({ path }: { path: string }) => <FileReference path={path} underline={false} />,
  'chat-file-link': ({ path, children }: { path: string; children?: ReactNode }) => (
    <FileReference path={path} underline>
      {children}
    </FileReference>
  ),
  'chat-web-lead': WebLinkLead,
  'chat-web-link': WebLink,
};

type MarkdownAsks = {
  answer?: string;
  onAnswer?: (text: string) => Promise<void>;
};

const AskContext = createContext<MarkdownAsks | undefined>(undefined);

function markAskCards(node: MarkdownNode): void {
  if (!node.children) return;
  node.children = node.children.map((child) => {
    const card =
      child.type === 'code' && child.lang?.toLowerCase() === ASK_CARD_LANGUAGE
        ? parseAskCard(child.value ?? '')
        : null;
    if (!card) {
      markAskCards(child);
      return child;
    }
    return {
      type: 'paragraph',
      children: [],
      data: { hName: 'ask-card', hProperties: { card: JSON.stringify(card) } },
    };
  });
}

const askTags = { 'ask-card': ['card'] };

function AskCardTag({ card }: { card?: string }) {
  const asks = use(AskContext);
  if (!card) return null;
  const groups = JSON.parse(card) as AskGroup[];
  const onAnswer = asks?.onAnswer;
  return (
    <AskCard
      answers={asks?.answer === undefined ? undefined : parseAskAnswer(groups, asks.answer)}
      groups={groups}
      onSubmit={onAnswer && ((answers) => onAnswer(formatAskAnswer(groups, answers)))}
    />
  );
}

const askComponents = { 'ask-card': AskCardTag };

const markdownStyles =
  '[&_[data-streamdown=link]:has(>[data-web-link])]:no-underline [&_p]:my-2 [&_p:first-child]:mt-0 [&_p:last-child]:mb-0 [&_li]:my-1 [&_h1]:mt-4 [&_h1]:mb-2 [&_h1]:text-ui-title-3 [&_h1]:font-semibold [&_h2]:mt-4 [&_h2]:mb-2 [&_h2]:text-ui-headline [&_h3]:mt-3 [&_h3]:mb-1 [&_h3]:text-ui-headline [&_blockquote]:border-l-2 [&_blockquote]:border-line [&_blockquote]:pl-3 [&_blockquote]:text-ink-2 [&_th]:border [&_th]:px-2 [&_th]:py-1 [&_th]:text-left [&_td]:border [&_td]:px-2 [&_td]:py-1 [&_code]:rounded [&_code]:bg-code [&_code]:px-1 [&_code]:py-0.5 [&_:not(pre)>code]:text-ui-callout [&_pre]:my-2 [&_pre]:rounded-control [&_pre]:bg-code [&_pre]:p-3 [&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_.katex-display]:overflow-x-auto [&_.katex-display]:overflow-y-hidden [&_[data-streamdown=code-block]]:gap-0 [&_[data-streamdown=code-block]]:rounded-card [&_[data-streamdown=code-block]]:border-0 [&_[data-streamdown=code-block]]:bg-code [&_[data-streamdown=code-block]]:p-0 [&_[data-streamdown=code-block-header]]:sticky [&_[data-streamdown=code-block-header]]:top-0 [&_[data-streamdown=code-block-header]]:z-10 [&_[data-streamdown=code-block-header]]:justify-start [&_[data-streamdown=code-block-header]]:rounded-t-card [&_[data-streamdown=code-block-header]]:bg-code [&_[data-streamdown=code-block-header]]:px-2 [&_[data-streamdown=code-block]>div:nth-child(2)]:-mt-8 [&_[data-streamdown=code-block]>div:nth-child(2)]:pr-3 [&_[data-streamdown=code-block]>div:nth-child(2)]:top-0 [&_[data-streamdown=code-block-body]]:rounded-none [&_[data-streamdown=code-block-body]]:border-none [&_[data-streamdown=code-block-body]]:bg-transparent [&_[data-streamdown=code-block-body]]:p-0 [&_[data-streamdown=code-block-body]_pre]:my-0 [&_[data-streamdown=code-block-body]_pre]:rounded-none [&_[data-streamdown=code-block-body]_pre]:rounded-b-card [&_[data-streamdown=code-block-actions]]:opacity-0 [&_[data-streamdown=code-block-actions]]:transition-opacity [&_[data-streamdown=code-block]:focus-within_[data-streamdown=code-block-actions]]:opacity-100 [&_[data-streamdown=code-block]:hover_[data-streamdown=code-block-actions]]:opacity-100 [&_div[data-streamdown=code-block-actions]]:border-0 [&_div[data-streamdown=code-block-actions]]:bg-transparent [&_div[data-streamdown=code-block-actions]]:p-0 [&_div[data-streamdown=code-block-actions]_button[data-streamdown=code-block-copy-button]]:rounded-control [&_div[data-streamdown=code-block-actions]_button[data-streamdown=code-block-copy-button]_svg]:size-3.5 [&_div[data-streamdown=code-block-actions]_button[data-streamdown=code-block-copy-button]:hover]:bg-hover-strong [&_[data-streamdown=unordered-list]]:list-outside [&_[data-streamdown=unordered-list]]:pl-5 [&_[data-streamdown=ordered-list]]:list-outside [&_[data-streamdown=ordered-list]]:pl-5 [&_[data-streamdown=code-block-header]_span:empty::after]:content-["txt"]';

export function ChatMarkdown({
  children,
  className,
  mode = 'static',
  replyImages = false,
  references,
  asks,
  ...props
}: ComponentProps<typeof Streamdown> & {
  replyImages?: boolean;
  references?: MarkdownReferences;
  asks?: MarkdownAsks;
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
    ...(asks ? [() => markAskCards] : []),
  ];
  const allowedTags = {
    ...(images ? replyImageTags : {}),
    ...(references ? referenceTags : {}),
    ...(asks ? askTags : {}),
  };
  const components = {
    ...(images ? replyComponents : chatComponents),
    ...(references ? referenceComponents : {}),
    ...(asks ? askComponents : {}),
  } as Components;
  return (
    <AskContext value={asks}>
      <ReferenceContext value={references}>
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
      </ReferenceContext>
    </AskContext>
  );
}
