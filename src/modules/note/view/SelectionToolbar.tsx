import { useState } from 'react';
import type { EditorView } from '@codemirror/view';
import {
  BoldIcon as Bold,
  CheckIcon as Check,
  ChevronDownIcon as ChevronDown,
  ItalicIcon as Italic,
  LinkIcon as Link,
} from '@heroicons/react/24/outline';
import { Button } from '../../../ui/Button';
import { DocumentToolbarButton, DocumentToolbarDivider } from '../../../ui/DocumentToolbar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../../../ui/DropdownMenu';
import { Popover, PopoverAnchor, PopoverContent } from '../../../ui/Popover';
import {
  removeLink,
  setBlockType,
  setLink,
  toggleInline,
  type BlockType,
  type SelectionFormat,
} from './markdown-format';

const blockLabels: Record<BlockType, string> = {
  paragraph: '正文',
  heading1: '一级标题',
  heading2: '二级标题',
  heading3: '三级标题',
  heading4: '四级标题',
  heading5: '五级标题',
  heading6: '六级标题',
  ordered: '编号列表',
  bullet: '项目符号列表',
  task: '检查清单',
};
const blockMenu: BlockType[] = [
  'paragraph',
  'heading1',
  'heading2',
  'heading3',
  'ordered',
  'bullet',
  'task',
];

export type SelectionAnchor = { current: { getBoundingClientRect: () => DOMRect } };

export function SelectionToolbar({
  anchor,
  format,
  visible,
  run,
}: {
  anchor: SelectionAnchor;
  format: SelectionFormat;
  visible: boolean;
  run: (command?: (view: EditorView) => void) => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [linkDraft, setLinkDraft] = useState<string | null>(null);
  return (
    <Popover
      open={visible || menuOpen || linkDraft !== null}
      onOpenChange={(open) => {
        if (open) return;
        setMenuOpen(false);
        setLinkDraft(null);
      }}
    >
      <PopoverAnchor virtualRef={anchor} />
      <PopoverContent
        side="top"
        updatePositionStrategy="always"
        hideWhenDetached
        aria-label="文本格式"
        role="toolbar"
        className="flex min-w-0 items-center gap-1 rounded-full px-1 py-0.5"
        onOpenAutoFocus={(event) => event.preventDefault()}
        onCloseAutoFocus={(event) => event.preventDefault()}
        onMouseDown={(event) => {
          if (!(event.target instanceof HTMLInputElement)) event.preventDefault();
        }}
      >
        {linkDraft === null ? (
          <>
            <DocumentToolbarButton
              label={format.link ? '取消链接' : '添加链接'}
              aria-pressed={format.link}
              disabled={!format.link && !format.singleLine}
              onClick={() => (format.link ? run(removeLink) : setLinkDraft(''))}
            >
              <Link />
            </DocumentToolbarButton>
            <DocumentToolbarButton
              label="粗体"
              aria-pressed={format.bold}
              onClick={() => run((view) => toggleInline(view, 'StrongEmphasis'))}
            >
              <Bold />
            </DocumentToolbarButton>
            <DocumentToolbarButton
              label="斜体"
              aria-pressed={format.italic}
              onClick={() => run((view) => toggleInline(view, 'Emphasis'))}
            >
              <Italic />
            </DocumentToolbarButton>
            <DocumentToolbarDivider />
            <DropdownMenu modal={false} open={menuOpen} onOpenChange={setMenuOpen}>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="sm" className="gap-1 pr-2">
                  {blockLabels[format.block]}
                  <ChevronDown className="size-3.5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="start"
                className="w-44"
                onCloseAutoFocus={(event) => {
                  event.preventDefault();
                  run();
                }}
              >
                {blockMenu.map((type) => (
                  <DropdownMenuItem
                    key={type}
                    onSelect={() => run((view) => setBlockType(view, type))}
                  >
                    {blockLabels[type]}
                    {format.block === type && <Check className="ml-auto text-ink" />}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        ) : (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              const url = linkDraft.trim();
              setLinkDraft(null);
              run(url ? (view) => setLink(view, url) : undefined);
            }}
          >
            <input
              ref={(input) => input?.focus()}
              aria-label="链接地址"
              placeholder="输入链接后按回车"
              className="h-control-xs w-64 bg-transparent px-2 text-ui-callout text-ink outline-none placeholder:text-ink-2"
              value={linkDraft}
              onChange={(event) => setLinkDraft(event.target.value)}
              onBlur={() => setLinkDraft(null)}
              onKeyDown={(event) => {
                if (event.key !== 'Escape') return;
                event.preventDefault();
                setLinkDraft(null);
                run();
              }}
            />
          </form>
        )}
      </PopoverContent>
    </Popover>
  );
}
