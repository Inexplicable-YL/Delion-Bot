import {
  BoltIcon,
  ChevronDownIcon,
  EyeIcon,
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
  'read-only': {
    label: '只读模式',
    detail: '可读取文件、联网查询和使用只读连接器。',
    icon: EyeIcon,
  },
  approval: {
    label: '请求批准',
    detail: '联网、连接器和有副作用的操作逐次批准。',
    icon: ShieldCheckIcon,
  },
  'auto-approval': {
    label: '自动批准',
    detail: '自动允许只读操作和工作目录内增改，风险操作须批准。',
    icon: BoltIcon,
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
  onSelect,
  side,
}: {
  mode: PermissionMode;
  onSelect: (mode: PermissionMode) => void;
  side: 'top' | 'bottom';
}) {
  const { defer, onCloseAutoFocus } = useAfterMenuClose();
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
          {permissionModeSchema.options.map((value) => (
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
