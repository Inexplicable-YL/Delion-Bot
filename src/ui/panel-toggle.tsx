import {
  ChevronDoubleLeftIcon as PanelLeftClose,
  ChevronDoubleRightIcon as PanelLeftOpen,
} from '@heroicons/react/24/outline';

type PanelToggleButtonProps = {
  collapsed: boolean;
  onToggle: () => void;
  label: string;
  controlsId?: string;
};

export function PanelToggleButton({
  collapsed,
  onToggle,
  label,
  controlsId,
}: PanelToggleButtonProps) {
  const Icon = collapsed ? PanelLeftOpen : PanelLeftClose;
  return (
    <button
      aria-controls={controlsId}
      aria-expanded={!collapsed}
      aria-label={collapsed ? `展开${label}` : `收起${label}`}
      className="grid size-7 shrink-0 place-items-center rounded-control text-ink-2 transition-colors duration-base hover:bg-hover hover:text-ink"
      onClick={onToggle}
      title={collapsed ? `展开${label}` : `收起${label}`}
      type="button"
    >
      <Icon className="size-4" />
    </button>
  );
}
