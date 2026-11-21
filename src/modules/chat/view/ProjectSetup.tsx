import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowUpTrayIcon,
  DocumentPlusIcon,
  DocumentTextIcon,
  PencilIcon,
  PlusIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';
import { errorMessage } from '../../../core/protocol/contract';
import { Button } from '../../../ui/button';
import { Card } from '../../../ui/card';
import { cn } from '../../../ui/cn';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from '../../../ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
  useAfterMenuClose,
} from '../../../ui/dropdown-menu';
import { IconButton } from '../../../ui/icon-button';
import { SegmentedControl } from '../../../ui/segmented-control';
import { Textarea } from '../../../ui/textarea';
import { showToast } from '../../../ui/toast';
import type { WorkspaceEntry } from '../../workspace/contract';
import { explorerDragType, localPathsOf } from '../../workspace/view';
import { useChatTabSource } from './chat-source';
import { chatClient } from './client';

const panels = ['suggestions', 'instructions', 'files'] as const;
const labels = { suggestions: '建议', instructions: '说明', files: '文件' };

export function ProjectSetup({ project }: { project: WorkspaceEntry }) {
  const { workbench } = useChatTabSource();
  const queryClient = useQueryClient();
  const { defer, onCloseAutoFocus } = useAfterMenuClose();
  const [panel, setPanel] = useState<(typeof panels)[number]>('suggestions');
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
    <section aria-label="项目设置" className="@container min-w-0 space-y-app-gap">
      <div className="flex items-center justify-between gap-2">
        <SegmentedControl
          aria-label="项目设置面板"
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

      {panel === 'suggestions' && (
        <div className="grid max-w-xl gap-app-gap @sm:grid-cols-2">
          {suggestions.map(({ panel, title, description }) => (
            <Card asChild key={panel} className="group min-w-0 text-left hover:shadow-raised">
              <button type="button" onClick={() => setPanel(panel)}>
                <div
                  aria-hidden
                  className="relative flex h-24 items-end overflow-hidden border-b border-line bg-page px-6"
                >
                  <div className="absolute inset-x-8 bottom-0 h-20 origin-bottom -rotate-3 rounded-t-control bg-fill shadow-hairline" />
                  <div className="relative grid h-20 w-full min-w-0 translate-y-2 content-start gap-2 rounded-t-control bg-surface px-3 pt-2 text-ink-2 shadow-card transition-transform duration-fast group-hover:translate-y-1 motion-reduce:transition-none">
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
                        <div className="flex min-w-0 items-center gap-2 rounded-chip bg-field p-1.5 text-ui-caption">
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
                <div className="space-y-1 p-4">
                  <p className="text-ui-title-3 text-ink">{title}</p>
                  <p className="text-ui-callout text-ink-2">{description}</p>
                </div>
              </button>
            </Card>
          ))}
        </div>
      )}

      {panel === 'instructions' && (
        <div className="min-h-36">
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
                <p className="max-h-48 overflow-auto wrap-anywhere whitespace-pre-wrap px-3 py-2 text-ui-body text-ink-2">
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
            'grid min-h-36 content-start gap-app-gap rounded-card',
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
            <p className="min-h-36 px-3 py-2 text-ui-callout text-ink-2">
              远程项目可直接引用服务器上的项目文件。
            </p>
          ) : context.data && !references.length ? (
            <Button
              variant="ghost"
              className={cn(
                'min-h-36 w-full flex-col gap-2 whitespace-normal rounded-card border border-dashed border-line-strong p-card-ui',
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
              className="grid max-h-48 w-full gap-1 overflow-y-auto py-1 scrollbar-none"
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
