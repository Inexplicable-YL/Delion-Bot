import { useState, type ReactNode, type Ref } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  ArrowsUpDownIcon,
  ChevronDownIcon,
  DocumentIcon as FileCode2,
  ExclamationTriangleIcon as TriangleAlert,
} from '@heroicons/react/24/outline';
import type { TabId } from '../../../../app/module';
import { Button } from '../../../../ui/Button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '../../../../ui/DropdownMenu';
import { IconButton } from '../../../../ui/IconButton';
import { PanelHeader } from '../../../../ui/PanelHeader';
import type { FileChangeDetail } from '../../../../core/protocol/agent';
import { agentClient, chatClient } from '../client';
import { parseReviewTabId } from './tab-id';
import { Centered, STATUS_TEXT, basenameOf, dirnameOf } from './ViewUtils';
import { DiffScroller, PatchDiffView } from './PierreDiff';
import { errorMessage } from '../../../../core/protocol/contract';

export function ReviewTab({ tabId }: { tabId: TabId; groupId: string }) {
  const target = parseReviewTabId(tabId);
  if (target?.kind === 'uncommitted')
    return <UncommittedFileReview projectId={target.projectId} path={target.path} />;
  if (target?.kind === 'turn')
    return (
      <TurnFileReview path={target.path} sessionId={target.sessionId} turnId={target.turnId} />
    );
  return (
    <Shell>
      <Centered>无效的审阅标签</Centered>
    </Shell>
  );
}

function TurnFileReview({
  sessionId,
  turnId,
  path,
}: {
  sessionId: string;
  turnId: string;
  path: string;
}) {
  const { data: detail, error } = useQuery({
    queryKey: ['chat', 'turn-file-change', sessionId, turnId, path],
    queryFn: () => agentClient['read-turn-file-change']({ sessionId, turnId, path }),
    staleTime: Infinity,
  });

  return <FileReview detail={detail} error={error} />;
}

function UncommittedFileReview({ projectId, path }: { projectId: string; path: string }) {
  const { data: detail, error } = useQuery({
    queryKey: ['chat', 'uncommitted-file', projectId, path],
    queryFn: () => chatClient.readUncommittedFileChange({ projectId, path }),
    gcTime: 0,
  });
  return <FileReview detail={detail} error={error} />;
}

const SPLIT_MIN_WIDTH = 900;
const diffLayouts = ['auto', 'unified', 'split'] as const;
const diffLayoutLabels = { auto: '自动', unified: '内联', split: '并排' } as const;
type DiffLayout = (typeof diffLayouts)[number];

function FileReview({
  detail,
  error,
}: {
  detail: FileChangeDetail | undefined;
  error: Error | null;
}) {
  const [layout, setLayout] = useState<DiffLayout>('auto');
  const [expandUnchanged, setExpandUnchanged] = useState(true);
  const [wide, setWide] = useState(false);

  const observeWidth = (element: HTMLElement) => {
    const update = () => setWide(element.getBoundingClientRect().width >= SPLIT_MIN_WIDTH);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  };

  if (error)
    return (
      <Shell>
        <Centered>
          <TriangleAlert aria-hidden className="size-4 text-ink-2" />
          {errorMessage(error)}
        </Centered>
      </Shell>
    );
  if (!detail)
    return (
      <Shell>
        <Centered role="status">正在读取变更…</Centered>
      </Shell>
    );

  const files =
    detail.before !== null && detail.after !== null
      ? {
          oldFile: { name: detail.path, contents: detail.before },
          newFile: { name: detail.path, contents: detail.after },
        }
      : null;
  return (
    <Shell ref={observeWidth}>
      <PanelHeader>
        <FileCode2 aria-hidden className="size-4 shrink-0 text-ink-2" />
        <span className="shrink-0 text-ui-headline">{basenameOf(detail.path)}</span>
        <span className="min-w-0 truncate text-ui-subhead text-ink-2" title={detail.path}>
          {dirnameOf(detail.path)}
        </span>
        <span className="shrink-0 text-ui-subhead text-ink-2">· {STATUS_TEXT[detail.status]}</span>
        {detail.patch && (
          <div className="ml-auto flex shrink-0 items-center gap-0.5">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button aria-label="差异布局" size="sm" variant="ghost">
                  {diffLayoutLabels[layout]}
                  <ChevronDownIcon className="size-3.5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="min-w-28">
                <DropdownMenuRadioGroup value={layout}>
                  {diffLayouts.map((option) => (
                    <DropdownMenuRadioItem
                      key={option}
                      onSelect={() => setLayout(option)}
                      value={option}
                    >
                      {diffLayoutLabels[option]}
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuContent>
            </DropdownMenu>
            {files && (
              <IconButton
                aria-label="展开未修改的代码"
                aria-pressed={expandUnchanged}
                onClick={() => setExpandUnchanged(!expandUnchanged)}
                size="xs"
                title="展开未修改的代码"
              >
                <ArrowsUpDownIcon />
              </IconButton>
            )}
          </div>
        )}
      </PanelHeader>
      {detail.note && (
        <p className="flex shrink-0 items-start gap-1.5 border-b border-line px-3 py-1.5 text-ui-subhead text-ink-2">
          <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
          {detail.note}
        </p>
      )}
      {detail.patch ? (
        <DiffScroller>
          <PatchDiffView
            diffStyle={layout === 'auto' ? (wide ? 'split' : 'unified') : layout}
            expandUnchanged={expandUnchanged}
            files={files}
            patch={detail.patch}
          />
        </DiffScroller>
      ) : (
        <Centered>此文件没有可展示的文本差异</Centered>
      )}
    </Shell>
  );
}

function Shell({ children, ref }: { children: ReactNode; ref?: Ref<HTMLElement> }) {
  return (
    <section
      ref={ref}
      aria-label="改动审阅"
      className="flex min-h-0 min-w-0 flex-1 flex-col bg-surface"
    >
      {children}
    </section>
  );
}
