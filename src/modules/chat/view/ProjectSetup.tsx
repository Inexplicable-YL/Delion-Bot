import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowUpTrayIcon,
  ChatBubbleLeftIcon,
  DocumentPlusIcon,
  DocumentTextIcon,
  PencilIcon,
  PlusIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';
import { errorMessage } from '../../../core/protocol/contract';
import { Button } from '../../../ui/Button';
import { Card } from '../../../ui/Card';
import { cn } from '../../../ui/cn';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from '../../../ui/Dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
  useAfterMenuClose,
} from '../../../ui/DropdownMenu';
import { IconButton } from '../../../ui/IconButton';
import { SegmentedControl } from '../../../ui/SegmentedControl';
import { Textarea } from '../../../ui/Textarea';
import { showToast } from '../../../ui/Toast';
import { useNow } from '../../../ui/use-now';
import type { WorkspaceEntry } from '../../workspace/contract';
import { explorerDragType, localPathsOf } from '../../workspace/view';
import { useChatTabSource } from './ChatSource';
import { chatClient } from './client';
import { useSessions } from './sessions';

const standardPanels = ['suggestions', 'instructions', 'files'] as const;
const historyPanels = ['suggestions', 'recent', 'instructions', 'files'] as const;
const labels = { suggestions: '建议', recent: '近期', instructions: '说明', files: '文件' };

function formatSessionTime(value: string, now: number) {
  const date = new Date(value);
  const minutes = Math.floor((now - date.getTime()) / 60_000);
  if (minutes < 1) return '刚刚';
  if (minutes < 60) return `${minutes} 分钟前`;
  if (minutes < 1_440) return `${Math.floor(minutes / 60)} 小时前`;
  if (minutes < 10_080) return `${Math.floor(minutes / 1_440)} 天前`;
  return date.toLocaleDateString('zh-CN');
}

export function ProjectSetup({
  project,
  onOpenSession,
}: {
  project: WorkspaceEntry;
  onOpenSession: (sessionId: string) => void;
}) {
  const { workbench } = useChatTabSource();
  const queryClient = useQueryClient();
  const { defer, onCloseAutoFocus } = useAfterMenuClose();
  const sessions = useSessions((state) => state.lists[project.id]);
  const recent = sessions?.toSorted((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 3);
  const panels = recent?.length ? historyPanels : standardPanels;
  const [selectedPanel, setPanel] = useState<(typeof historyPanels)[number]>('suggestions');
  const panel = selectedPanel === 'recent' && !recent?.length ? 'suggestions' : selectedPanel;
  const now = useNow(60_000, panel === 'recent');
  const [draft, setDraft] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const queryKey = ['chat', 'project-context', project.id];
  const context = useQuery({ queryKey, queryFn: () => chatClient.projectContext(project.id) });
  const instruction = context.data?.instruction;
  const references = context.data?.files ?? [];
  const save = useMutation({
    mutationFn: (instruction: string) =>
      chatClient.setProjectInstruction({ projectId: project.id, instruction }),
    onSuccess: (saved) => {
      queryClient.setQueryData(queryKey, saved);
      setDraft(null);
      showToast({ variant: 'success', title: '已保存项目说明' });
    },
    onError: (error) =>
      showToast({ variant: 'error', title: '保存说明失败', description: errorMessage(error) }),
  });
  const files = useMutation({
    mutationFn: (
      action:
        | Parameters<typeof chatClient.addProjectFiles>[0]['files']
        | { kind: 'remove'; path: string },
    ) =>
      action.kind === 'remove'
        ? chatClient.removeProjectFile({ projectId: project.id, path: action.path })
        : chatClient.addProjectFiles({ projectId: project.id, files: action }),
    onSuccess: (saved) => queryClient.setQueryData(queryKey, saved),
    onError: (error) =>
      showToast({ variant: 'error', title: '更新项目文件失败', description: errorMessage(error) }),
  });
  const suggestions = [
    {
      panel: 'instructions',
      title: instruction ? '查看说明' : '添加说明',
      description: '告诉 Agent 如何在此项目中工作',
    },
    {
      panel: 'files',
      title: project.remoteId ? '引用项目文件' : '添加文件',
      description: '为 Agent 提供项目资料',
    },
  ] as const;

  return (
    <section aria-label="项目设置" className="@container min-w-0 space-y-app-gap pl-1">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <SegmentedControl
          aria-label="项目设置面板"
          className="[&>button]:px-4"
          labels={labels}
          options={panels}
          value={panel}
          onChange={setPanel}
        />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <IconButton aria-label="添加上下文" title="添加上下文" size="md">
              <PlusIcon />
            </IconButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-40" onCloseAutoFocus={onCloseAutoFocus}>
            <DropdownMenuLabel>添加上下文</DropdownMenuLabel>
            <DropdownMenuItem
              disabled={Boolean(project.remoteId) || files.isPending}
              onSelect={() =>
                defer(() => {
                  setPanel('files');
                  files.mutate({ kind: 'pick' });
                })
              }
            >
              <DocumentPlusIcon /> 文件
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={instruction === undefined}
              onSelect={() => defer(() => setDraft(instruction ?? ''))}
            >
              <PencilIcon /> 说明
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div className="relative">
        <div className="grid max-w-108 grid-cols-2 gap-3">
          {panel === 'suggestions' ? (
            suggestions.map(({ panel, title, description }) => (
              <Card
                asChild
                key={panel}
                className="group aspect-4/3 min-w-0 text-left hover:shadow-raised"
              >
                <button type="button" className="flex flex-col" onClick={() => setPanel(panel)}>
                  <div
                    aria-hidden
                    className="relative flex h-8 w-full shrink-0 items-end overflow-hidden border-b border-line bg-page px-3 @xs:h-12 @sm:h-16 @sm:px-5"
                  >
                    <div className="absolute inset-x-4 bottom-0 h-full origin-bottom -rotate-3 rounded-t-control bg-fill shadow-hairline @sm:inset-x-6 @sm:h-14" />
                    <div className="relative grid h-full w-full min-w-0 translate-y-1 content-start gap-1 rounded-t-control bg-surface px-2 pt-1.5 text-ink-2 shadow-card transition-transform duration-fast group-hover:translate-y-0 motion-reduce:transition-none @sm:h-14">
                      {panel === 'instructions' ? (
                        <>
                          <p className="border-b border-line pb-1 text-ui-caption text-ink">
                            项目说明
                          </p>
                          <p className="truncate text-ui-caption">
                            {instruction || '先说明结论，再列出依据。'}
                          </p>
                          <div className="h-1 w-2/3 rounded-pill bg-fill" />
                        </>
                      ) : (
                        <>
                          <div className="flex min-w-0 items-center gap-1.5 rounded-chip bg-field p-1 text-ui-caption">
                            <span className="shrink-0 rounded-chip bg-fill px-1.5 text-ink">
                              文档
                            </span>
                            <span className="truncate text-ink">
                              {references[0]?.split(/[\\/]/).at(-1) || '项目资料'}
                            </span>
                          </div>
                          <div className="h-1 w-full rounded-pill bg-fill" />
                          <div className="h-1 w-3/4 rounded-pill bg-field" />
                        </>
                      )}
                    </div>
                  </div>
                  <div className="flex flex-1 flex-col justify-center gap-1 px-2 py-1 @xs:px-3 @xs:py-2">
                    <p className="text-ui-title-3 text-ink">{title}</p>
                    <p className="line-clamp-2 text-ui-callout text-ink-2">{description}</p>
                  </div>
                </button>
              </Card>
            ))
          ) : (
            <div aria-hidden className="aspect-4/3" />
          )}
        </div>

        {panel === 'recent' && (
          <ul aria-label="近期会话" className="absolute inset-0 space-y-1 overflow-y-auto">
            {recent?.map((session) => (
              <li key={session.id}>
                <Button
                  variant="ghost"
                  className="w-full min-w-0 justify-start rounded-control text-left"
                  title={session.title}
                  onClick={() => onOpenSession(session.id)}
                >
                  <ChatBubbleLeftIcon aria-hidden className="text-ink-2" />
                  <span className="min-w-0 flex-1 truncate">{session.title || '新对话'}</span>
                  <time
                    dateTime={session.updatedAt}
                    className="shrink-0 text-ui-subhead text-ink-2"
                  >
                    {formatSessionTime(session.updatedAt, now)}
                  </time>
                </Button>
              </li>
            ))}
          </ul>
        )}

        {panel === 'instructions' && (
          <div className="absolute inset-0 flex flex-col">
            {context.isError ? (
              <p role="alert" className="px-3 py-2 text-ui-callout text-ink-2">
                读取项目说明失败。
              </p>
            ) : instruction === undefined ? (
              <p role="status" className="px-3 py-2 text-ui-callout text-ink-2">
                正在读取说明…
              </p>
            ) : (
              <>
                <Button
                  variant="ghost"
                  className="min-h-row-regular w-full justify-start gap-2 whitespace-normal rounded-control text-left text-ui-body"
                  onClick={() => setDraft(instruction)}
                >
                  <PencilIcon />{' '}
                  {instruction ? '编辑项目说明' : '添加说明，告诉 Agent 如何在此项目中工作'}
                </Button>
                {instruction && (
                  <p className="min-h-0 overflow-y-auto wrap-anywhere whitespace-pre-wrap px-3 py-2 text-ui-body text-ink-2">
                    {instruction}
                  </p>
                )}
              </>
            )}
          </div>
        )}

        {panel === 'files' && (
          <div
            className={cn(
              'absolute inset-0 flex flex-col rounded-card',
              dragging && 'bg-accent-tint',
            )}
            onDragOver={(event) => {
              if (
                !event.dataTransfer.types.some(
                  (type) => type === 'Files' || type === explorerDragType,
                )
              )
                return;
              event.preventDefault();
              if (project.remoteId || files.isPending) return;
              event.dataTransfer.dropEffect = 'copy';
              setDragging(true);
            }}
            onDragLeave={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget as Node | null))
                setDragging(false);
            }}
            onDrop={(event) => {
              event.preventDefault();
              event.stopPropagation();
              setDragging(false);
              if (project.remoteId || files.isPending) return;
              const entry = event.dataTransfer.getData(explorerDragType);
              if (entry) files.mutate({ kind: 'entry', id: entry });
              else {
                const paths = localPathsOf([...event.dataTransfer.files]);
                if (paths.length) files.mutate({ kind: 'paths', paths });
              }
            }}
          >
            {project.remoteId ? (
              <p className="px-3 py-2 text-ui-callout text-ink-2">
                远程项目可直接引用服务器上的项目文件。
              </p>
            ) : context.data && !references.length ? (
              <Button
                variant="ghost"
                className={cn(
                  'h-full w-full flex-col gap-2 whitespace-normal rounded-card border border-dashed border-line-strong p-card-ui',
                  dragging && 'border-accent-ink text-ink',
                )}
                disabled={files.isPending}
                onClick={() => files.mutate({ kind: 'pick' })}
              >
                <ArrowUpTrayIcon aria-hidden className="size-6" />
                <span>{files.isPending ? '正在添加文件…' : '拖放文件到这里，或点击选择'}</span>
              </Button>
            ) : null}
            {references.length ? (
              <ul
                aria-label="项目文件引用"
                className="grid min-h-0 w-full gap-1 overflow-y-auto py-1 scrollbar-none"
              >
                {references.map((path) => {
                  const name = path.split(/[\\/]/).at(-1);
                  return (
                    <li key={path} className="flex min-w-0 items-center gap-1">
                      <Button
                        variant="ghost"
                        className="min-w-0 flex-1 justify-start rounded-control text-left"
                        title={path}
                        onClick={() => workbench.openDocument(path)}
                      >
                        <DocumentTextIcon aria-hidden />
                        <span className="truncate">{name}</span>
                      </Button>
                      <IconButton
                        aria-label={'移除引用 ' + name}
                        disabled={files.isPending}
                        onClick={() => files.mutate({ kind: 'remove', path })}
                        size="md"
                      >
                        <XMarkIcon />
                      </IconButton>
                    </li>
                  );
                })}
              </ul>
            ) : context.isError ? (
              <p role="alert" className="text-ui-callout text-ink-2">
                读取文件列表失败。
              </p>
            ) : null}
          </div>
        )}
      </div>
      <Dialog
        open={draft !== null}
        onOpenChange={(open) => {
          if (!open && !save.isPending) setDraft(null);
        }}
      >
        {draft !== null && (
          <DialogContent size="lg">
            <DialogTitle>设置项目说明</DialogTitle>
            <DialogDescription>这些说明适用于此项目中的对话。</DialogDescription>
            <form
              className="mt-4"
              onSubmit={(event) => {
                event.preventDefault();
                if (!save.isPending && draft.trim() !== instruction) save.mutate(draft);
              }}
            >
              <Textarea
                aria-label="项目说明"
                className="min-h-44 resize-y"
                value={draft}
                maxLength={2000}
                placeholder="例如：先说明结论，再列出依据。"
                disabled={save.isPending}
                onChange={(event) => setDraft(event.target.value)}
              />
              <DialogFooter>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={save.isPending}
                  onClick={() => setDraft(null)}
                >
                  取消
                </Button>
                <Button
                  size="sm"
                  type="submit"
                  variant="accent"
                  disabled={draft.trim() === instruction || save.isPending}
                >
                  {save.isPending ? '正在保存…' : '保存说明'}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        )}
      </Dialog>
    </section>
  );
}
