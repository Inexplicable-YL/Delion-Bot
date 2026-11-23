import { useState } from 'react';
import {
  ArrowTopRightOnSquareIcon as OpenIcon,
  CheckIcon as Check,
  LinkIcon,
  PencilIcon as Pencil,
} from '@heroicons/react/24/outline';
import { Button } from '../../../ui/Button';
import { IconButton } from '../../../ui/IconButton';
import { Input } from '../../../ui/Input';
import { Popover, PopoverAnchor, PopoverContent } from '../../../ui/Popover';
import { isComposerUrl, linkSource, type ComposerLink } from './composer-links';

type Mode = 'actions' | 'text' | 'url';

function LinkField({
  label,
  initial,
  valid,
  onSubmit,
}: {
  label: string;
  initial: string;
  valid: (value: string) => boolean;
  onSubmit: (value: string) => void;
}) {
  const [value, setValue] = useState(initial);
  const ok = valid(value.trim());
  return (
    <form
      className="flex w-80 max-w-full items-center gap-1 pl-1"
      onSubmit={(event) => {
        event.preventDefault();
        if (ok) onSubmit(value.trim());
      }}
    >
      <Input
        aria-invalid={!ok || undefined}
        aria-label={label}
        className="rounded-pill"
        autoFocus
        onChange={(event) => setValue(event.target.value)}
        onFocus={(event) => event.currentTarget.select()}
        value={value}
      />
      <IconButton
        aria-label="确认"
        className="rounded-pill"
        disabled={!ok}
        title="确认"
        type="submit"
      >
        <Check />
      </IconButton>
    </form>
  );
}

export function ComposerLinkMenu({
  link,
  anchor,
  onReplace,
  onClose,
}: {
  link: ComposerLink;
  anchor: DOMRect;
  onReplace: (insert: string) => void;
  onClose: () => void;
}) {
  const [mode, setMode] = useState<Mode>('actions');
  return (
    <Popover onOpenChange={(open) => !open && onClose()} open>
      <PopoverAnchor virtualRef={{ current: { getBoundingClientRect: () => anchor } }} />
      <PopoverContent
        align="start"
        aria-label="链接操作"
        className="min-w-0 rounded-pill"
        onCloseAutoFocus={(event) => event.preventDefault()}
        onOpenAutoFocus={(event) => event.preventDefault()}
        side="top"
      >
        {mode === 'actions' ? (
          <div className="flex items-center gap-0.5">
            <Button
              onClick={() => {
                window.open(link.url, '_blank', 'noreferrer');
                onClose();
              }}
              size="sm"
              variant="ghost"
            >
              <OpenIcon aria-hidden />
              打开链接
            </Button>
            <Button onClick={() => setMode('text')} size="sm" variant="ghost">
              <Pencil aria-hidden />
              编辑文本
            </Button>
            <Button onClick={() => setMode('url')} size="sm" variant="ghost">
              <LinkIcon aria-hidden />
              编辑链接
            </Button>
          </div>
        ) : mode === 'text' ? (
          <LinkField
            initial={link.text}
            label="链接文本"
            onSubmit={(text) => onReplace(linkSource(text, link.url))}
            valid={() => true}
          />
        ) : (
          <LinkField
            initial={link.url}
            label="链接地址"
            onSubmit={(url) => onReplace(linkSource(link.text === link.url ? url : link.text, url))}
            valid={isComposerUrl}
          />
        )}
      </PopoverContent>
    </Popover>
  );
}
