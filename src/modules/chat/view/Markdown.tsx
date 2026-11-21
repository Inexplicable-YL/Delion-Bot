import 'katex/dist/katex.min.css';

import type { ComponentProps } from 'react';
import { code } from '@streamdown/code';
import { createMathPlugin } from '@streamdown/math';
import type { MermaidConfig } from '@streamdown/mermaid';
import {
  Streamdown,
  defaultTranslations,
  type ControlsConfig,
  type DiagramPlugin,
  type LinkSafetyConfig,
} from 'streamdown';
import { cn } from '../../../ui/cn';
import { mermaidConfig, renderMermaid } from '../../preview/view';
import { useChatTabSource } from './ChatSource';

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

const markdownStyles =
  '[&_p]:my-2 [&_p:first-child]:mt-0 [&_p:last-child]:mb-0 [&_li]:my-1 [&_h1]:mt-4 [&_h1]:mb-2 [&_h1]:text-ui-title-3 [&_h1]:font-semibold [&_h2]:mt-4 [&_h2]:mb-2 [&_h2]:text-ui-headline [&_h3]:mt-3 [&_h3]:mb-1 [&_h3]:text-ui-headline [&_blockquote]:border-l-2 [&_blockquote]:border-line [&_blockquote]:pl-3 [&_blockquote]:text-ink-2 [&_th]:border [&_th]:px-2 [&_th]:py-1 [&_th]:text-left [&_td]:border [&_td]:px-2 [&_td]:py-1 [&_code]:rounded [&_code]:bg-code [&_code]:px-1 [&_code]:py-0.5 [&_:not(pre)>code]:text-ui-callout [&_pre]:my-2 [&_pre]:rounded-control [&_pre]:bg-code [&_pre]:p-3 [&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_.katex-display]:overflow-x-auto [&_.katex-display]:overflow-y-hidden [&_[data-streamdown=code-block]]:gap-0 [&_[data-streamdown=code-block]]:rounded-card [&_[data-streamdown=code-block]]:border-0 [&_[data-streamdown=code-block]]:bg-code [&_[data-streamdown=code-block]]:p-0 [&_[data-streamdown=code-block-header]]:sticky [&_[data-streamdown=code-block-header]]:top-0 [&_[data-streamdown=code-block-header]]:z-10 [&_[data-streamdown=code-block-header]]:justify-start [&_[data-streamdown=code-block-header]]:rounded-t-card [&_[data-streamdown=code-block-header]]:bg-code [&_[data-streamdown=code-block-header]]:px-2 [&_[data-streamdown=code-block]>div:nth-child(2)]:-mt-8 [&_[data-streamdown=code-block]>div:nth-child(2)]:pr-3 [&_[data-streamdown=code-block]>div:nth-child(2)]:top-0 [&_[data-streamdown=code-block-body]]:rounded-none [&_[data-streamdown=code-block-body]]:border-none [&_[data-streamdown=code-block-body]]:bg-transparent [&_[data-streamdown=code-block-body]]:p-0 [&_[data-streamdown=code-block-body]_pre]:my-0 [&_[data-streamdown=code-block-body]_pre]:rounded-none [&_[data-streamdown=code-block-body]_pre]:rounded-b-card [&_[data-streamdown=code-block-actions]]:opacity-0 [&_[data-streamdown=code-block-actions]]:transition-opacity [&_[data-streamdown=code-block]:focus-within_[data-streamdown=code-block-actions]]:opacity-100 [&_[data-streamdown=code-block]:hover_[data-streamdown=code-block-actions]]:opacity-100 [&_div[data-streamdown=code-block-actions]]:border-0 [&_div[data-streamdown=code-block-actions]]:bg-transparent [&_div[data-streamdown=code-block-actions]]:p-0 [&_div[data-streamdown=code-block-actions]_button[data-streamdown=code-block-copy-button]]:rounded-control [&_div[data-streamdown=code-block-actions]_button[data-streamdown=code-block-copy-button]_svg]:size-3.5 [&_div[data-streamdown=code-block-actions]_button[data-streamdown=code-block-copy-button]:hover]:bg-hover-strong [&_[data-streamdown=unordered-list]]:list-outside [&_[data-streamdown=unordered-list]]:pl-5 [&_[data-streamdown=ordered-list]]:list-outside [&_[data-streamdown=ordered-list]]:pl-5 [&_[data-streamdown=code-block-header]_span:empty::after]:content-["txt"]';

export function ChatMarkdown({
  children,
  className,
  mode = 'static',
  ...props
}: ComponentProps<typeof Streamdown>) {
  const { opensLink } = useChatTabSource();
  const linkSafety: LinkSafetyConfig = { enabled: true, onLinkCheck: opensLink };
  return (
    <Streamdown
      className={cn(markdownStyles, className)}
      codeBlockMaxHeight={0}
      components={chatComponents}
      controls={chatControls}
      linkSafety={linkSafety}
      mermaid={mermaidOptions()}
      mode={mode}
      plugins={chatStreamdownPlugins}
      skipHtml
      translations={chatTranslations}
      {...props}
    >
      {children}
    </Streamdown>
  );
}
