import type { ReactNode } from 'react';
import {
  ArrowsUpDownIcon as ArrowsUpDown,
  ArchiveBoxIcon as Archive,
  ClockIcon as Clock,
  EllipsisHorizontalIcon as MoreHorizontal,
  PlusIcon as Plus,
} from '@heroicons/react/24/outline';
import { CollapseChevron } from '../../../ui/Collapse';
import { cn } from '../../../ui/cn';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '../../../ui/DropdownMenu';
import { IconButton } from '../../../ui/IconButton';
import type { NavListPreference } from '../shell/preferences';
import { rowEndInset } from './nav-styles';

export type NavListOptions<T> = ReadonlyArray<readonly [T, string]>;

const statusOptions: NavListOptions<NavListPreference<string>['status']> = [
  ['active', '已启用'],
  ['archived', '已归档'],
  ['all', '所有的'],
];
const activityOptions: NavListOptions<NavListPreference<string>['activityDays']> = [
  [0, '所有的'],
  [1, '过去 1 天'],
  [7, '过去 7 天'],
  [30, '过去 30 天'],
];

const DAY_MS = 86_400_000;

export const activitySince = (days: number) => (days ? Date.now() - days * DAY_MS : 0);

export function NavListHeader<Sort extends string>({
  titleId,
  title,
  sortLabel,
  sortOptions,
  preference,
  onChange,
  createLabel,
  onCreate,
}: {
  titleId: string;
  title: string;
  sortLabel: string;
  sortOptions: NavListOptions<Sort>;
  preference: NavListPreference<Sort>;
  onChange: (patch: Partial<NavListPreference<Sort>>) => void;
  createLabel: string;
  onCreate?: () => void;
}) {
  const open = !preference.collapsed;
  return (
    <div className={cn('flex min-h-control-xs shrink-0 items-center gap-1 pb-1 pl-2', rowEndInset)}>
      <button
        aria-expanded={open}
        className="flex min-w-0 items-center gap-1 rounded-chip text-ui-subhead text-ink-2 hover:text-ink"
        id={titleId}
        onClick={() => onChange({ collapsed: open })}
        type="button"
      >
        {title}
        <CollapseChevron
          className={cn(
            'size-3.5',
            open && 'invisible group-hover/list:visible group-focus-within/list:visible',
          )}
          open={open}
        />
      </button>
      <div className="flex-1" />
      <div className="invisible flex shrink-0 items-center gap-0.5 group-hover/list:visible group-focus-within/list:visible has-[[data-state=open]]:visible max-md:visible touch:visible">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <IconButton size="sm" aria-label={`${title}显示选项`} title="显示选项">
              <MoreHorizontal />
            </IconButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" side="right" className="min-w-64">
            <OptionMenu
              icon={<ArrowsUpDown />}
              label={sortLabel}
              options={sortOptions}
              value={preference.sort}
              onChange={(sort) => onChange({ sort })}
            />
            <DropdownMenuSeparator />
            <DropdownMenuLabel>显示</DropdownMenuLabel>
            <OptionMenu
              icon={<Archive />}
              label="状态"
              options={statusOptions}
              value={preference.status}
              onChange={(status) => onChange({ status })}
            />
            <OptionMenu
              icon={<Clock />}
              label="最后活动"
              options={activityOptions}
              value={preference.activityDays}
              onChange={(activityDays) => onChange({ activityDays })}
            />
          </DropdownMenuContent>
        </DropdownMenu>
        {onCreate && (
          <IconButton size="sm" aria-label={createLabel} onClick={onCreate} title={createLabel}>
            <Plus />
          </IconButton>
        )}
      </div>
    </div>
  );
}

function OptionMenu<T extends string | number | boolean>({
  icon,
  label,
  options,
  value,
  onChange,
}: {
  icon: ReactNode;
  label: string;
  options: NavListOptions<T>;
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger>
        {icon}
        <span className="flex-1 whitespace-nowrap">{label}</span>
        <span className="ml-4 whitespace-nowrap text-ink-3">
          {options.find(([option]) => option === value)?.[1]}
        </span>
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent className="min-w-40">
        <DropdownMenuRadioGroup value={String(value)}>
          {options.map(([option, optionLabel]) => (
            <DropdownMenuRadioItem
              key={String(option)}
              value={String(option)}
              onSelect={() => onChange(option)}
            >
              {optionLabel}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}
