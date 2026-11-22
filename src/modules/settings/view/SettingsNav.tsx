import {
  AdjustmentsHorizontalIcon as SlidersHorizontal,
  ArchiveBoxIcon as Archive,
  BellIcon as Bell,
  CircleStackIcon as HardDrive,
  CloudIcon as Cloud,
  CommandLineIcon as Keyboard,
  CommandLineIcon as Terminal,
  CpuChipIcon as Bot,
  DocumentTextIcon as ScrollText,
  InformationCircleIcon as Info,
  PuzzlePieceIcon as Puzzle,
  ShieldCheckIcon as ShieldCheck,
  Squares2X2Icon as LayoutGrid,
  SquaresPlusIcon as Blocks,
  SwatchIcon as Palette,
} from '@heroicons/react/24/outline';
import type { OutlineIcon } from '../../../ui/outline-icon';
import { settingsSectionLabels, type SettingsSectionId } from '../contract';
import { cn } from '../../../ui/cn';
import { horizontalWheelRef } from '../../../ui/use-horizontal-wheel';

export type { SettingsSectionId };

const sections: Array<{ id: SettingsSectionId; group: string; icon: OutlineIcon }> = [
  { id: 'general', group: '通用', icon: SlidersHorizontal },
  { id: 'appearance', group: '通用', icon: Palette },
  { id: 'shortcuts', group: '通用', icon: Keyboard },
  { id: 'notifications', group: '通用', icon: Bell },
  { id: 'storage', group: '通用', icon: HardDrive },
  { id: 'providers', group: 'Agent', icon: Bot },
  { id: 'capabilities', group: 'Agent', icon: Blocks },
  { id: 'commands', group: 'Agent', icon: Terminal },
  { id: 'skills', group: 'Agent', icon: Puzzle },
  { id: 'workspace', group: '工作区', icon: LayoutGrid },
  { id: 'remotes', group: '工作区', icon: Cloud },
  { id: 'archived', group: '工作区', icon: Archive },
  { id: 'about', group: '其他', icon: Info },
  { id: 'privacy', group: '其他', icon: ShieldCheck },
  { id: 'terms', group: '其他', icon: ScrollText },
];

const sectionGroups = sections.reduce<Array<{ title: string; items: typeof sections }>>(
  (groups, section) => {
    const last = groups.at(-1);
    if (last && last.title === section.group) last.items.push(section);
    else groups.push({ title: section.group, items: [section] });
    return groups;
  },
  [],
);

type SettingsNavProps = {
  value: SettingsSectionId;
  onSectionChange: (section: SettingsSectionId) => void;
};

export function SettingsNav({ value, onSectionChange }: SettingsNavProps) {
  return (
    <nav
      aria-label="设置分区"
      className="flex shrink-0 gap-1 overflow-x-auto rounded-panel glass-thick p-app-inset [scrollbar-width:none] max-md:[mask-image:linear-gradient(to_right,black_calc(100%-1.5rem),transparent)] md:w-44 lg:w-sidebar md:flex-col md:gap-4 md:overflow-y-auto"
      ref={horizontalWheelRef}
    >
      {sectionGroups.map((group, index) => (
        <div className="flex shrink-0 gap-1 md:grid md:gap-1" key={group.title}>
          {index > 0 && (
            <span aria-hidden="true" className="mx-1 w-px shrink-0 bg-line md:hidden" />
          )}
          <span className="hidden h-6 items-center px-2 text-ui-subhead text-ink-2 md:flex">
            {group.title}
          </span>
          {group.items.map(({ id, icon: Icon }) => {
            const active = value === id;
            return (
              <button
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'flex min-h-row-compact touch:min-h-row-regular shrink-0 items-center gap-2.5 rounded-control px-2.5 text-ui-button',
                  active ? 'bg-selected text-ink' : 'text-ink-2 hover:bg-hover hover:text-ink',
                )}
                key={id}
                onClick={() => onSectionChange(id)}
                type="button"
              >
                <Icon
                  className={cn('size-5 shrink-0', active ? 'text-accent-ink' : 'text-ink-2')}
                />
                <span className="truncate">{settingsSectionLabels[id]}</span>
              </button>
            );
          })}
        </div>
      ))}
    </nav>
  );
}
