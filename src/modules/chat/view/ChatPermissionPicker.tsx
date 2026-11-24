import { ChevronDownIcon, ShieldCheckIcon } from '@heroicons/react/24/outline';
import { permissionModeSchema, type PermissionMode } from '../../../core/protocol/agent';
import { PromptInputTrigger } from '../../../ui/agent/PromptInput';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
  useAfterMenuClose,
} from '../../../ui/DropdownMenu';

const permissions = {
  'read-only': { label: '只读模式', detail: '读取聊天目录中的文件。' },
  approval: { label: '请求批准', detail: '联网、连接器和有副作用的操作逐次批准。' },
  'project-write': { label: '项目内修改', detail: '直接读取和修改项目目录中的文件。' },
  full: { label: '完全访问', detail: '使用当前用户的文件、终端和网络权限。' },
} satisfies Record<PermissionMode, { label: string; detail: string }>;

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
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <PromptInputTrigger
          aria-label="Agent 权限"
          className="text-ui-headline"
          title={permissions[mode].label}
        >
          <ShieldCheckIcon aria-hidden="true" className="size-4 shrink-0" />
          <span className="truncate">{permissions[mode].label}</span>
          <ChevronDownIcon aria-hidden="true" className="size-4 shrink-0" />
        </PromptInputTrigger>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="w-64"
        onCloseAutoFocus={onCloseAutoFocus}
        side={side}
      >
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
              className="h-auto min-h-control-sm py-2"
            >
              <span className="grid min-w-0 gap-1">
                <span>{permissions[value].label}</span>
                <span className="text-ui-callout text-ink-2">{permissions[value].detail}</span>
              </span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
