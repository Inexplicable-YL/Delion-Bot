import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  CheckIcon as Check,
  ChevronDownIcon as ChevronDown,
  MagnifyingGlassIcon as Search,
  ShareIcon as GitBranch,
} from '@heroicons/react/24/outline';
import { Popover, PopoverContent, PopoverTrigger } from '../../../ui/popover';
import { showToast } from '../../../ui/toast';
import type { ComposerContext } from './composer-context';
import { workspaceClient } from '../../workspace/view';
import { errorMessage } from '../../../core/protocol/contract';

const pill =
  'flex h-7 min-w-0 max-w-60 items-center gap-1.5 rounded-control border border-line bg-surface px-2 text-ui-subhead text-ink-2 transition-colors duration-base hover:bg-hover hover:text-ink';
const searchRow = 'mb-1 flex items-center gap-2 rounded-control px-2 py-1.5 text-ink-2';
const searchInput =
  'min-w-0 flex-1 bg-transparent text-ui-body text-ink outline-none placeholder:text-ink-2';
const option =
  'flex w-full items-center gap-2 rounded-control px-2 py-1.5 text-left text-ui-body text-ink transition-colors duration-fast hover:bg-hover';
const empty = 'px-2 py-2 text-ui-subhead text-ink-2';

const matches = (value: string, query: string) =>
  value.toLowerCase().includes(query.trim().toLowerCase());

export function ComposerBranchPicker({ context }: { context: ComposerContext }) {
  const queryClient = useQueryClient();
  const { projectId, remote } = context;
  const [branchQuery, setBranchQuery] = useState('');
  const [branchOpen, setBranchOpen] = useState(false);

  const hasLocalRepo = Boolean(projectId) && !remote && Boolean(window.delionBot);
  const current =
    useQuery({
      queryKey: ['workspace', 'projectBranch', projectId],
      queryFn: () => workspaceClient.projectBranch(projectId!),
      enabled: hasLocalRepo,
    }).data ?? null;
  const branchList = useQuery({
    queryKey: ['workspace', 'projectBranches', projectId],
    queryFn: () => workspaceClient.projectBranches(projectId!),
    enabled: hasLocalRepo && branchOpen,
  });
  const branches = branchList.data ?? [];
  const branchesFailed = branchList.isError;

  const switchBranch = (branch: string) => {
    setBranchOpen(false);
    if (!projectId || branch === current || !window.delionBot) return;
    void workspaceClient
      .switchProjectBranch({ id: projectId, branch })
      .then(() =>
        queryClient.invalidateQueries({ queryKey: ['workspace', 'projectBranch', projectId] }),
      )
      .catch((error: unknown) =>
        showToast({
          variant: 'error',
          title: '切换分支失败',
          description: errorMessage(error),
        }),
      );
  };

  const visibleBranches = branches.filter((branch) => matches(branch, branchQuery));

  if (!current) return null;
  return (
    <div className="mt-app-gap flex justify-end">
      <Popover onOpenChange={setBranchOpen} open={branchOpen}>
        <PopoverTrigger asChild>
          <button aria-label="切换分支" className={pill} type="button">
            <GitBranch aria-hidden className="size-4 shrink-0" />
            <span className="truncate">{current}</span>
            <ChevronDown aria-hidden className="size-4 shrink-0 opacity-60" />
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-64" side="top">
          <label className={searchRow}>
            <Search aria-hidden className="size-4 shrink-0" />
            <input
              aria-label="搜索分支"
              className={searchInput}
              onChange={(event) => setBranchQuery(event.target.value)}
              placeholder="搜索分支"
              value={branchQuery}
            />
          </label>
          <div className="max-h-64 overflow-y-auto">
            {visibleBranches.map((branch) => (
              <button
                className={option}
                key={branch}
                onClick={() => switchBranch(branch)}
                type="button"
              >
                <GitBranch aria-hidden className="size-4 shrink-0" />
                <span className="min-w-0 flex-1 truncate">{branch}</span>
                {branch === current && <Check aria-hidden className="size-4 shrink-0" />}
              </button>
            ))}
            {branchesFailed ? (
              <p className={empty}>分支列表加载失败</p>
            ) : (
              visibleBranches.length === 0 && <p className={empty}>没有匹配的分支</p>
            )}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
