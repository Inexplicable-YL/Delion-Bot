import {
  ChevronDownIcon,
  EyeIcon,
  PencilSquareIcon,
  ShieldCheckIcon,
  ShieldExclamationIcon,
} from '@heroicons/react/24/outline';
import type { ComponentType, SVGProps } from 'react';
import { permissionModeSchema, type PermissionMode } from '../../../core/protocol/agent';
import { PromptInputTrigger } from '../../../ui/agent/PromptInput';
import { cn } from '../../../ui/cn';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
  useAfterMenuClose,
} from '../../../ui/DropdownMenu';

const permissions = {
  'read-only': { label: '只读模式', detail: '读取聊天目录中的文件。', icon: EyeIcon },
  approval: {
    label: '请求批准',
    detail: '联网、连接器和有副作用的操作逐次批准。',
    icon: ShieldCheckIcon,
  },
  'project-write': {
    label: '项目内修改',
    detail: '直接读取和修改项目目录中的文件。',
    icon: PencilSquareIcon,
  },
  full: {
    label: '完全访问',
    detail: '使用当前用户的文件、终端和网络权限。',
    icon: ShieldExclamationIcon,
  },
} satisfies Record<
  PermissionMode,
  { label: string; detail: string; icon: ComponentType<SVGProps<SVGSVGElement>> }
>;

export function ChatPermissionPicker({
  mode,
  project,
  onSelect,
  side,
}: {
  mode: PermissionMode;
  project: boolean;
  onSelect: (mode: PermissionMode) => void;
  side: 'top' | 'bottom';
}) {
  const { defer, onCloseAutoFocus } = useAfterMenuClose();
  const modes = permissionModeSchema.options.filter(
    (value) => project || value !== 'project-write',
  );
  const ModeIcon = permissions[mode].icon;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <PromptInputTrigger
          aria-label="Agent 权限"
          className={cn('text-ui-callout', mode === 'full' && 'text-warning hover:text-warning')}
          data-slot="composer-permission"
          title={permissions[mode].label}
        >
          <ModeIcon aria-hidden="true" className="size-3.5 shrink-0" />
          <span className="truncate">{permissions[mode].label}</span>
          <ChevronDownIcon aria-hidden="true" className="size-3.5 shrink-0" />
        </PromptInputTrigger>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" onCloseAutoFocus={onCloseAutoFocus} side={side}>
        <DropdownMenuRadioGroup
          value={mode}
          onValueChange={(value) => {
            const parsed = permissionModeSchema.safeParse(value);
            if (parsed.success) defer(() => onSelect(parsed.data));
          }}
        >
          {modes.map((value) => (
            <DropdownMenuRadioItem
              key={value}
              value={value}
              className={cn(
                'focus:bg-hover data-[highlighted]:bg-hover',
                value === 'full' && 'text-warning',
              )}
              title={permissions[value].detail}
            >
              {permissions[value].label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
