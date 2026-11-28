import { useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  ArrowDownIcon,
  ArrowsUpDownIcon,
  ArrowUpIcon,
  ChevronDownIcon,
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
import { DocumentToolbar, DocumentToolbarButton } from '../../../../ui/DocumentToolbar';
import { Resizer } from '../../../../ui/Resizer';
import { Spinner } from '../../../../ui/Spinner';
import { CodeScrollbar } from '../../../preview/view';
import type { FileChangeDetail } from '../../../../core/protocol/agent';
import { agentClient, chatClient } from '../client';
import { parseReviewTabId } from './tab-id';
import { Centered, STATUS_TEXT } from './ViewUtils';
import { DiffScroller, PatchDiffView } from './PierreDiff';
import type { ReviewDiffRenderer } from './review-diff-renderer';
import { errorMessage } from '../../../../core/protocol/contract';

export function ReviewTab({ tabId }: { tabId: TabId; groupId: string }) {
  const target = parseReviewTabId(tabId);
  if (target?.kind === 'uncommitted')
    return <UncommittedFileReview projectId={target.projectId} path={target.path} />;
  if (target?.kind === 'turn')
    return (
      <TurnFileReview path={target.path} sessionId={target.sessionId} turnId={target.turnId} />
    );
  if (target?.kind === 'version')
    return (
      <VersionFileReview
        fromEventId={target.fromEventId}
        path={target.path}
        sessionId={target.sessionId}
        toEventId={target.toEventId}
      />
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
  const {
    data: detail,
    error,
    refetch,
  } = useQuery({
    queryKey: ['chat', 'turn-file-change', sessionId, turnId, path],
    queryFn: () => agentClient['read-turn-file-change']({ sessionId, turnId, path }),
    staleTime: Infinity,
  });

  return <FileReview detail={detail} error={error} onReload={() => void refetch()} />;
}

function VersionFileReview({
  sessionId,
  fromEventId,
  toEventId,
  path,
}: {
  sessionId: string;
  fromEventId: string;
  toEventId: string;
  path: string;
}) {
  const {
    data: detail,
    error,
    refetch,
  } = useQuery({
    queryKey: ['chat', 'version-file-change', sessionId, fromEventId, toEventId, path],
    queryFn: () => chatClient.readFileVersion({ sessionId, fromEventId, toEventId, path }),
    staleTime: Infinity,
  });

  return <FileReview detail={detail} error={error} onReload={() => void refetch()} />;
}

function UncommittedFileReview({ projectId, path }: { projectId: string; path: string }) {
  const {
    data: detail,
    error,
    refetch,
  } = useQuery({
    queryKey: ['chat', 'uncommitted-file', projectId, path],
    queryFn: () => chatClient.readUncommittedFileChange({ projectId, path }),
    gcTime: 0,
  });
  return <FileReview detail={detail} error={error} onReload={() => void refetch()} />;
}

const SPLIT_MIN_WIDTH = 900;
const MIN_PANE_RATIO = 0.25;
const diffLayouts = ['auto', 'unified', 'split'] as const;
const diffLayoutLabels = { auto: '自动', unified: '内联', split: '并排' } as const;
type DiffLayout = (typeof diffLayouts)[number];

function FileReview({
  detail,
  error,
  onReload,
}: {
  detail: FileChangeDetail | undefined;
  error: Error | null;
  onReload: () => void;
}) {
  const [layout, setLayout] = useState<DiffLayout>('auto');
  const [expandedPatch, setExpandedPatch] = useState<string | null>(null);
  const [width, setWidth] = useState(0);
  const [splitRatio, setSplitRatio] = useState(0.5);
  const renderer = useRef<ReviewDiffRenderer | null>(null);
  const scrollbarsRef = useRef<HTMLDivElement | null>(null);

  const observeWidth = (element: HTMLDivElement | null) => {
    const viewport = element?.firstElementChild;
    if (!viewport) return;
    const update = () => setWidth(viewport.clientWidth);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(viewport);
    return () => observer.disconnect();
  };

  if (error)
    return (
      <Shell>
        <Centered role="alert">
          <div className="min-w-0 text-left">
            <p className="break-words">{errorMessage(error)}</p>
            <Button variant="ghost" onClick={onReload}>
              重试
            </Button>
          </div>
        </Centered>
      </Shell>
    );
  if (!detail)
    return (
      <Shell>
        <Centered role="status">
          <Spinner className="mr-2" />
          正在打开…
        </Centered>
      </Shell>
    );

  const oldFile = detail.before !== null ? { name: detail.path, contents: detail.before } : null;
  const newFile = detail.after !== null ? { name: detail.path, contents: detail.after } : null;
  const diffStyle = layout === 'auto' ? (width >= SPLIT_MIN_WIDTH ? 'split' : 'unified') : layout;
  const split = diffStyle === 'split' && detail.status === 'modified';
  const expandUnchanged = detail.patch !== null && expandedPatch === detail.patch;
  const onContextExpansionChange = (expanded: boolean) =>
    setExpandedPatch(expanded ? detail.patch : null);
  return (
    <Shell label={`改动审阅：${STATUS_TEXT[detail.status]} ${detail.path}`}>
      <DocumentToolbar
        path={detail.path.split(/[/\\]+/).filter(Boolean)}
        onReload={onReload}
        controls={
          detail.patch && (
            <>
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
              <DocumentToolbarButton
                label="上一个改动"
                onClick={() => renderer.current?.jumpToChange('previous')}
              >
                <ArrowUpIcon />
              </DocumentToolbarButton>
              <DocumentToolbarButton
                label="下一个改动"
                onClick={() => renderer.current?.jumpToChange('next')}
              >
                <ArrowDownIcon />
              </DocumentToolbarButton>
              {oldFile && newFile && (
                <DocumentToolbarButton
                  label={expandUnchanged ? '收起所有未修改的代码' : '展开所有未修改的代码'}
                  aria-pressed={expandUnchanged}
                  onClick={() => {
                    if (renderer.current)
                      onContextExpansionChange(renderer.current.toggleAllContext());
                  }}
                >
                  <ArrowsUpDownIcon />
                </DocumentToolbarButton>
              )}
            </>
          )
        }
      />
      {detail.note && (
        <p className="shrink-0 border-b px-4 py-2 text-ui-subhead text-ink-2">{detail.note}</p>
      )}
      {detail.patch && (
        <div
          ref={scrollbarsRef}
          className="pointer-events-none absolute inset-x-0 bottom-0 z-sticky grid min-w-0"
          style={{
            width: width || undefined,
            gridTemplateColumns: split ? `${width * splitRatio}px minmax(0, 1fr)` : undefined,
          }}
        >
          {(split ? ['原始代码', '修改后的代码'] : ['代码']).map((label, index) => (
            <CodeScrollbar
              key={index}
              label={`横向滚动${label}`}
              className="row-start-1"
              style={{ gridColumn: index + 1 }}
            />
          ))}
        </div>
      )}
      {detail.patch ? (
        <div
          className="relative flex min-h-0 min-w-0 flex-1 flex-col"
          ref={observeWidth}
          style={{ '--review-split': `${splitRatio * 100}%` } as CSSProperties}
        >
          <DiffScroller>
            <PatchDiffView
              key={detail.patch}
              diffStyle={diffStyle}
              newFile={newFile}
              oldFile={oldFile}
              onContextExpansionChange={onContextExpansionChange}
              patch={detail.patch}
              rendererRef={renderer}
              scrollbarsRef={scrollbarsRef}
            />
          </DiffScroller>
          {split && width > 0 && (
            <div className="absolute inset-y-0 z-raised w-px" style={{ left: width * splitRatio }}>
              <Resizer
                label="调整差异视图分栏宽度"
                value={width * splitRatio}
                min={width * MIN_PANE_RATIO}
                max={width * (1 - MIN_PANE_RATIO)}
                defaultValue={width / 2}
                onChange={(next) => setSplitRatio(next / width)}
                className="h-full w-full bg-line-strong"
              />
            </div>
          )}
        </div>
      ) : (
        <Centered>此文件没有可展示的文本差异</Centered>
      )}
    </Shell>
  );
}

function Shell({ children, label = '改动审阅' }: { children: ReactNode; label?: string }) {
  return (
    <section
      aria-label={label}
      data-code-scroll-surface=""
      className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
    >
      {children}
    </section>
  );
}
