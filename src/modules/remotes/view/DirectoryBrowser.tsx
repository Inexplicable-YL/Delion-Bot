import { useState, type KeyboardEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ChevronRightIcon as ChevronRight,
  ClockIcon as Clock,
  FolderIcon as Folder,
  FolderPlusIcon as FolderPlus,
  HomeIcon as House,
} from '@heroicons/react/24/outline';
import { Card } from '../../../ui/Card';
import { Checkbox } from '../../../ui/Checkbox';
import { Input } from '../../../ui/Input';
import { SearchInput } from '../../../ui/SearchInput';
import { Skeleton } from '../../../ui/Skeleton';
import { cn } from '../../../ui/cn';
import type { RemoteDraft } from '../contract';
import { showToast } from '../../../ui/Toast';
import { remotesClient } from './client';
import { IconButton } from '../../../ui/IconButton';
import { errorMessage } from '../../../core/protocol/contract';

function crumbs(path: string): { name: string; path: string }[] {
  const parts = path.split('/').filter(Boolean);
  return [
    { name: '/', path: '/' },
    ...parts.map((name, index) => ({ name, path: `/${parts.slice(0, index + 1).join('/')}` })),
  ];
}

export function tildePath(path: string, home: string | null): string {
  if (!home || home === '/') return path;
  if (path === home) return '~';
  return path.startsWith(`${home}/`) ? `~${path.slice(home.length)}` : path;
}

interface Scratch {
  path: string;
  filter: string;
  typed: string;
  creating: string | null;
}

const scratchOf = (path: string): Scratch => ({ path, filter: '', typed: path, creating: null });

const scrollIntoView = (element: HTMLElement | null) =>
  element?.scrollIntoView({ block: 'nearest' });

export function DirectoryBrowser({
  draft,
  home,
  recent,
  path,
  selected,
  onNavigate,
  onSelect,
}: {
  draft: RemoteDraft;
  home: string | null;
  recent: string[];
  path: string;
  selected: string | null;
  onNavigate: (path: string) => void;
  onSelect: (path: string | null) => void;
}) {
  const queryClient = useQueryClient();
  const [showHidden, setShowHidden] = useState(false);
  const [editing, setEditing] = useState(false);
  const [stored, setStored] = useState(() => scratchOf(path));
  const scratch = stored.path === path ? stored : scratchOf(path);
  const { filter, typed, creating } = scratch;
  const edit = (patch: Partial<Scratch>) => setStored({ ...scratch, ...patch });
  const browseKey = [
    'remotes',
    'browse',
    draft.host,
    draft.port ?? null,
    draft.keyPath ?? null,
    path,
  ];
  const browse = useQuery({
    queryKey: browseKey,
    queryFn: () => remotesClient.browse({ draft, path }),
    gcTime: Infinity,
  });
  const cached = browse.data;
  const loading = browse.isFetching;
  const error = !loading && browse.error ? errorMessage(browse.error) : null;

  const createFolder = async () => {
    const name = creating?.trim();
    if (!window.delionBot || !name) return;
    const invalid = /[/\0]/.test(name)
      ? '文件夹名不能包含 /，只能新建一层'
      : name === '.' || name === '..'
        ? '文件夹名不能是 . 或 ..'
        : null;
    if (invalid) {
      showToast({ variant: 'error', title: '无法新建文件夹', description: invalid });
      return;
    }
    try {
      const created = await remotesClient.mkdir({ draft, parent: path, name });
      await queryClient.refetchQueries(
        { queryKey: browseKey, exact: true },
        { throwOnError: true },
      );
      edit({ creating: null });
      onSelect(created);
    } catch (cause) {
      showToast({ variant: 'error', title: '新建文件夹失败', description: errorMessage(cause) });
    }
  };

  const needle = filter.trim().toLowerCase();
  const directories = (cached?.directories ?? []).filter(
    (entry) =>
      (showHidden || !entry.name.startsWith('.')) &&
      (!needle || entry.name.toLowerCase().includes(needle)),
  );

  const parent =
    cached?.parent ?? (path === '/' ? null : path.slice(0, path.lastIndexOf('/')) || '/');

  const onListKey = (event: KeyboardEvent<HTMLUListElement>) => {
    const index = directories.findIndex((entry) => entry.path === selected);
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const next =
        event.key === 'ArrowDown'
          ? Math.min(index + 1, directories.length - 1)
          : Math.max(index - 1, 0);
      const entry = directories[next];
      if (entry) onSelect(entry.path);
    } else if ((event.key === 'ArrowRight' || event.key === 'Enter') && selected) {
      event.preventDefault();
      onNavigate(selected);
    } else if ((event.key === 'ArrowLeft' || event.key === 'Backspace') && parent) {
      event.preventDefault();
      onNavigate(parent);
    }
  };

  return (
    <Card className="grid min-h-0 grid-rows-[auto_auto_1fr_auto]">
      <div className="flex items-center gap-1.5 border-b border-line px-2 py-1.5">
        <IconButton
          size="sm"
          aria-label="主目录"

          disabled={!home}
          onClick={() => home && onNavigate(home)}
          title="主目录"
        >
          <House />
        </IconButton>
        {editing ? (
          <Input
            aria-label="远端路径"
            autoFocus
            className="h-7 font-mono text-ui-subhead"
            onBlur={() => setEditing(false)}
            onChange={(event) => edit({ typed: event.target.value })}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                const value = typed.trim().replace(/^~(?=\/|$)/, home ?? '~');
                if (value.startsWith('/')) onNavigate(value.replace(/\/+$/, '') || '/');
                setEditing(false);
              } else if (event.key === 'Escape') {
                event.preventDefault();
                event.stopPropagation();
                setEditing(false);
              }
            }}
            value={typed}
          />
        ) : (
          <button
            aria-label="编辑路径"
            className="flex h-7 min-w-0 flex-1 items-center overflow-hidden rounded-chip px-1 text-left font-mono text-ui-subhead hover:bg-hover"
            onClick={() => setEditing(true)}
            title={`${path}（点击输入路径）`}
            type="button"
          >
            <span className="flex min-w-0 items-center overflow-hidden whitespace-nowrap [direction:rtl]">
              <span className="flex items-center [direction:ltr]">
                {crumbs(path).map((crumb, index, all) => (
                  <span className="flex items-center" key={crumb.path}>
                    {index > 1 && <ChevronRight className="size-4 shrink-0 text-ink-2" />}
                    <span
                      className={cn(
                        'rounded-chip px-0.5',
                        index === all.length - 1 ? 'text-ink' : 'text-ink-2 hover:text-ink',
                      )}
                      onClick={(event) => {
                        if (index === all.length - 1) return;
                        event.stopPropagation();
                        onNavigate(crumb.path);
                      }}
                    >
                      {crumb.name}
                    </span>
                  </span>
                ))}
              </span>
            </span>
          </button>
        )}
        <SearchInput
          aria-label="过滤目录"
          className="w-32 shrink-0"
          onChange={(event) => edit({ filter: event.target.value })}
          placeholder="过滤"
          value={filter}
        />
      </div>

      {recent.length > 0 ? (
        <div className="flex min-w-0 items-center gap-1.5 overflow-x-auto border-b border-line px-2.5 py-1.5 text-ui-subhead">
          <Clock className="size-4 shrink-0 text-ink-2" aria-hidden="true" />
          <span className="shrink-0 text-ink-2">最近</span>
          {recent.map((item) => (
            <button
              className="shrink-0 rounded-chip bg-hover px-1.5 py-0.5 font-mono text-ink-2 transition-colors duration-base hover:bg-hover-strong hover:text-ink"
              key={item}
              onClick={() => onNavigate(item)}
              title={item}
              type="button"
            >
              {tildePath(item, home)}
            </button>
          ))}
        </div>
      ) : (
        <div />
      )}

      <ul
        aria-busy={loading}
        aria-label="远端目录"
        className="min-h-48 overflow-y-auto py-1 outline-none focus-visible:bg-hover/40"
        onKeyDown={onListKey}
        role="listbox"
        tabIndex={0}
      >
        {creating !== null && (
          <li className="px-2 py-1">
            <div className="flex items-center gap-2 px-1">
              <FolderPlus className="size-4 shrink-0 text-ink-2" />
              <Input
                aria-label="新文件夹名称"
                autoFocus
                className="h-7 text-ui-subhead"
                onChange={(event) => edit({ creating: event.target.value })}
                onKeyDown={(event) => {
                  event.stopPropagation();
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    void createFolder();
                  } else if (event.key === 'Escape') {
                    event.preventDefault();
                    edit({ creating: null });
                  }
                }}
                placeholder="新文件夹名称，回车创建"
                value={creating}
              />
            </div>
          </li>
        )}
        {parent && (
          <li>
            <button
              className="flex h-7 w-full items-center gap-2 px-3 text-left text-ui-body text-ink-2 hover:bg-hover hover:text-ink"
              onClick={() => onNavigate(parent)}
              tabIndex={-1}
              type="button"
            >
              <Folder className="size-4 shrink-0" />
              ..
            </button>
          </li>
        )}
        {directories.map((entry) => (
          <li
            aria-selected={entry.path === selected}
            key={entry.path}
            ref={entry.path === selected ? scrollIntoView : undefined}
            role="option"
          >
            <button
              className={cn(
                'flex h-7 w-full min-w-0 items-center gap-2 px-3 text-left text-ui-body transition-colors duration-fast',
                entry.path === selected
                  ? 'bg-selected text-ink'
                  : 'text-ink-2 hover:bg-hover hover:text-ink',
              )}
              onClick={() => onSelect(entry.path === selected ? null : entry.path)}
              onDoubleClick={() => onNavigate(entry.path)}
              tabIndex={-1}
              title={`${entry.path}（双击进入）`}
              type="button"
            >
              <Folder
                className={cn(
                  'size-4 shrink-0',
                  entry.name.startsWith('.') ? 'text-ink-2' : 'text-ink-2',
                )}
              />
              <span className="min-w-0 flex-1 truncate">{entry.name}</span>
              <ChevronRight
                className="size-4 shrink-0 text-ink-2 hover:text-ink"
                onClick={(event) => {
                  event.stopPropagation();
                  onNavigate(entry.path);
                }}
              />
            </button>
          </li>
        ))}
        {!cached &&
          loading &&
          [0, 1, 2, 3].map((index) => (
            <li className="flex h-7 items-center gap-2 px-3" key={index}>
              <Skeleton className="size-4" />
              <Skeleton className="h-2.5 rounded-full" style={{ width: `${40 + index * 12}%` }} />
            </li>
          ))}
        {cached && directories.length === 0 && (
          <li className="px-3 py-2 text-ui-subhead text-ink-2">
            {filter ? '没有匹配的目录。' : '此目录下没有子目录。'}
          </li>
        )}
        {error && (
          <li className="px-3 py-2 text-ui-subhead wrap-anywhere text-danger" role="alert">
            {error}
          </li>
        )}
      </ul>

      <div className="flex items-center justify-between border-t border-line px-2.5 py-1.5 text-ui-subhead text-ink-2">
        <span className="flex-1" />
        <button
          className="mr-3 flex items-center gap-1 rounded-chip px-1 py-0.5 hover:bg-hover hover:text-ink"
          onClick={() => edit({ creating: '' })}
          type="button"
        >
          <FolderPlus className="size-4" />
          新建文件夹
        </button>
        <label className="flex items-center gap-1.5">
          <Checkbox
            checked={showHidden}
            onChange={(event) => setShowHidden(event.target.checked)}
          />
          显示隐藏目录
        </label>
      </div>
    </Card>
  );
}
