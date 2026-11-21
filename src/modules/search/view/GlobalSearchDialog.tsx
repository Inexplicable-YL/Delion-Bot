import { useState, type KeyboardEvent } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useDebounce } from 'use-debounce';
import {
  ChatBubbleLeftIcon as MessageSquare,
  CheckCircleIcon as CircleCheckBig,
  Cog6ToothIcon as Settings,
  DocumentTextIcon as FileText,
  FolderIcon as FolderKanban,
  MagnifyingGlassIcon as Search,
} from '@heroicons/react/24/outline';
import type { OutlineIcon } from '../../../ui/outline-icon';
import { createClient } from '../../../core/protocol/contract';
import { cn } from '../../../ui/cn';
import { SEARCH_LIMIT, searchContract, type SearchHit, type SearchIcon } from '../contract';
import { ErrorText } from '../../../ui/Alert';
import { EmptyState } from '../../../ui/EmptyState';
import { Spinner } from '../../../ui/Spinner';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
  DialogClose,
} from '../../../ui/Dialog';

const search = createClient(searchContract, window.delionBot?.bridge);

const groupIcons: Record<SearchIcon, OutlineIcon> = {
  folder: FolderKanban,
  message: MessageSquare,
  file: FileText,
  check: CircleCheckBig,
  settings: Settings,
};

const listId = 'global-search-results';
const optionId = (index: number) => `global-search-result-${index}`;

export function GlobalSearchDialog({
  onOpenChange,
  onSelect,
  open,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (hit: SearchHit) => void;
}) {
  const [query, setQuery] = useState('');
  const [term, setTerm] = useState('');
  const [debouncedTerm] = useDebounce(term.trim(), 180);
  const results = useQuery({
    queryKey: ['search', debouncedTerm],
    queryFn: () => search.query(debouncedTerm),
    enabled: open,
    placeholderData: keepPreviousData,
  });
  const groups = results.data ?? [];
  const hits = groups.flatMap((group) => group.hits);
  const [selection, setSelection] = useState({ batch: -1, index: -1 });
  const selectedIndex =
    selection.batch === results.dataUpdatedAt ? selection.index : hits.length ? 0 : -1;
  const select = (index: number) => setSelection({ batch: results.dataUpdatedAt, index });
  const hasContent = hits.length > 0;
  const isRecent = !term.trim();
  const busy = results.isFetching;
  const error = results.error?.message ?? null;

  const activate = (hit: SearchHit) => {
    onSelect(hit);
    onOpenChange(false);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && hasContent) {
      event.preventDefault();
      const delta = event.key === 'ArrowDown' ? 1 : -1;
      const next = (selectedIndex + delta + hits.length) % hits.length;
      select(next);
      document.getElementById(optionId(next))?.scrollIntoView({ block: 'nearest' });
      return;
    }
    const selected = hits[selectedIndex];
    if (event.key === 'Enter' && !event.nativeEvent.isComposing && selected) {
      event.preventDefault();
      activate(selected);
    }
  };

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="flex max-h-search-dialog max-w-xl flex-col overflow-hidden p-0">
        <div className="flex items-center gap-2.5 border-b px-4 py-2.5">
          <Search aria-hidden="true" className="size-4 shrink-0 text-ink-2" />
          <DialogTitle className="sr-only">全局搜索</DialogTitle>
          <DialogDescription className="sr-only">
            搜索已同步到本机的项目、聊天、待办和设置入口。
          </DialogDescription>
          <input
            aria-activedescendant={selectedIndex >= 0 ? optionId(selectedIndex) : undefined}
            aria-autocomplete="list"
            aria-controls={listId}
            aria-expanded={hasContent}
            aria-label="全局搜索"
            className="min-w-0 flex-1 bg-transparent text-ui-body outline-none placeholder:text-ink-2"
            maxLength={200}
            onChange={(event) => {
              setQuery(event.target.value);
              if (!(event.nativeEvent as InputEvent).isComposing) setTerm(event.target.value);
            }}
            onCompositionEnd={(event) => setTerm(event.currentTarget.value)}
            onKeyDown={handleKeyDown}
            placeholder="搜索项目、聊天或待办…"
            role="combobox"
            value={query}
          />
          {busy ? <Spinner className="shrink-0 text-ink-2" /> : null}
          <DialogClose aria-label="关闭搜索" />
        </div>
        <div className="h-80 min-h-0 overflow-y-auto p-2">
          {error && !hasContent ? (
            <ErrorText size="sm" className="px-3 py-5">
              {error}
            </ErrorText>
          ) : null}
          {!hasContent && busy ? (
            <div
              className="flex items-center gap-2 px-3 py-5 text-ui-body text-ink-2"
              role="status"
            >
              <Spinner />
              正在获取本地已同步的数据…
            </div>
          ) : null}
          {!hasContent && !busy && !error ? (
            <EmptyState
              title={isRecent ? '还没有可显示的最近记录。' : '没有找到匹配的本地数据。'}
            />
          ) : null}
          {hasContent ? (
            <div id={listId} role="listbox">
              <p className="px-2.5 pb-1 pt-1.5 text-ui-subhead text-ink-2">
                {isRecent ? '本地记录' : '搜索结果'}
              </p>
              {groups.map((group) => {
                const Icon = groupIcons[group.icon];
                return (
                  <section className="mt-1" key={group.id}>
                    <h3 className="flex items-center gap-2 px-2.5 py-1 text-ui-subhead text-ink-2">
                      <Icon aria-hidden="true" className="size-3.5" />
                      {group.truncated ? `${group.label}（最多 ${SEARCH_LIMIT} 条）` : group.label}
                    </h3>
                    {group.hits.map((hit) => {
                      const index = hits.indexOf(hit);
                      return (
                        <div
                          aria-selected={selectedIndex === index}
                          className={cn(
                            'flex cursor-pointer items-center gap-2.5 rounded-card px-2.5 py-2 outline-none transition-colors',
                            selectedIndex === index ? 'bg-selected text-ink' : 'hover:bg-hover',
                          )}
                          id={optionId(index)}
                          key={`${group.id}-${hit.id}`}
                          onClick={() => activate(hit)}
                          onMouseMove={() => select(index)}
                          role="option"
                        >
                          <span
                            aria-hidden="true"
                            className="grid size-7 shrink-0 place-items-center rounded-control bg-inset"
                          >
                            <Icon className="size-4 text-ink-2" />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-ui-headline">{hit.title}</span>
                            {hit.subtitle ? (
                              <span className="mt-0.5 block truncate text-ui-subhead text-ink-2">
                                {hit.subtitle}
                              </span>
                            ) : null}
                          </span>
                        </div>
                      );
                    })}
                  </section>
                );
              })}
              {error ? (
                <p className="px-3 py-2 text-ui-subhead text-danger" role="status">
                  {error}
                </p>
              ) : null}
            </div>
          ) : null}
        </div>
        <div className="flex items-center gap-3 border-t px-4 py-1.5 text-ui-subhead text-ink-2">
          <span>↑↓ 选择</span>
          <span>↵ 打开</span>
          <span className="ml-auto">Esc 关闭</span>
        </div>
      </DialogContent>
    </Dialog>
  );
}
