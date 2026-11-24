import { useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  CheckIcon,
  CloudIcon,
  DocumentPlusIcon,
  DocumentTextIcon,
  FolderIcon,
  FolderPlusIcon,
  GlobeAltIcon,
  PlusIcon,
  AdjustmentsHorizontalIcon,
  WrenchScrewdriverIcon,
  AtSymbolIcon,
  ChatBubbleLeftIcon,
} from '@heroicons/react/24/outline';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
  useAfterMenuClose,
} from '../../../ui/DropdownMenu';
import { IconButton } from '../../../ui/IconButton';
import { Input } from '../../../ui/Input';
import type { WebSearchEntrySummary } from '../../../core/protocol/capabilities';
import { ConnectorAppIcon, type ConnectorApp } from '../../connectors/view';
import { useWorkspaceStore } from '../../workspace/view';
import { useChatTabSource } from './ChatSource';
import { capabilitiesClient } from './client';

export function ChatComposerMenu({
  className = '',
  allowProjectSwitch,
  projectId,
  onSelectProject,
  projectSwitching,
  connectors,
  connectorsFailed,
  connectorsLoading,
  onConnector,
  onUpload,
  onReference,
  onSkill,
  searchEntries,
  searchFailed,
  searchSelectedId,
  onRefreshSearch,
  onSelectSearch,
  permissionMode = null,
  onPermissionMode,
}: {
  className?: string;
  allowProjectSwitch: boolean;
  projectId: string | null;
  onSelectProject?: (projectId: string | null) => void;
  projectSwitching: boolean;
  connectors?: ConnectorApp[];
  connectorsFailed: boolean;
  connectorsLoading: boolean;
  onConnector: (app: ConnectorApp) => void;
  onUpload: () => void;
  onReference: () => void;
  onSkill: (name: string) => void;
  searchEntries: WebSearchEntrySummary[] | null;
  searchFailed: boolean;
  searchSelectedId: string | null;
  onRefreshSearch: () => void;
  onSelectSearch?: (id: string | null) => void;
  permissionMode?: 'restricted' | 'full' | null;
  onPermissionMode?: (mode: 'restricted' | 'full') => void;
}) {
  const { navigate, onCreateProject } = useChatTabSource();
  const entries = useWorkspaceStore((state) => state.workspace.entries);
  const projectSearch = useRef<HTMLInputElement>(null);
  const [projectQuery, setProjectQuery] = useState('');
  const projectKeyword = projectQuery.trim().toLowerCase();
  const projects = entries.filter(
    (entry) => entry.kind === 'project' && entry.name.toLowerCase().includes(projectKeyword),
  );
  const showGeneral = '随聊'.includes(projectKeyword);
  const [skillsOpen, setSkillsOpen] = useState(false);
  const { data: skills, isError } = useQuery({
    queryKey: ['capabilities', 'skills'],
    queryFn: () => capabilitiesClient.listSkills(),
    enabled: skillsOpen && Boolean(window.delionBot),
  });
  const visibleSkills = new Map<string, string>();
  for (const skill of skills ?? []) {
    if (skill.enabled && (!skill.group || skill.group.id === projectId))
      visibleSkills.set(skill.name, skill.description);
  }
  const { defer, onCloseAutoFocus } = useAfterMenuClose();
  const selectProject = (nextProjectId: string | null) => {
    if (nextProjectId === projectId) return;
    if (onSelectProject) onSelectProject(nextProjectId);
    else navigate({ page: 'chat', projectId: nextProjectId });
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <IconButton
          aria-label="添加到对话"
          className={`rounded-pill bg-hover hover:bg-hover-strong aria-expanded:bg-hover-strong ${className}`}
          data-slot="composer-add"
          size="lg"
        >
          <PlusIcon />
        </IconButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        className="w-52 rounded-panel"
        onCloseAutoFocus={onCloseAutoFocus}
      >
        <DropdownMenuItem onSelect={onUpload}>
          <DocumentPlusIcon /> 上传文件
        </DropdownMenuItem>
        {allowProjectSwitch && (
          <DropdownMenuSub
            onOpenChange={(open) => {
              if (!open) setProjectQuery('');
            }}
          >
            <DropdownMenuSubTrigger disabled={projectSwitching}>
              <FolderIcon /> 项目
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent
              className="w-56 rounded-panel"
              onKeyDown={(event) => {
                if (event.key !== 'Tab') return;
                event.preventDefault();
                projectSearch.current?.focus();
              }}
            >
              <Input
                aria-label="搜索项目"
                className="px-2"
                onChange={(event) => setProjectQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Escape') return;
                  event.stopPropagation();
                  if (event.key === 'ArrowDown' || event.key === 'Tab') {
                    event.preventDefault();
                    event.currentTarget
                      .closest('[role="menu"]')
                      ?.querySelector<HTMLElement>('[role="menuitem"]')
                      ?.focus();
                  }
                }}
                placeholder="搜索项目…"
                ref={projectSearch}
                value={projectQuery}
                variant="ghost"
              />
              <DropdownMenuSeparator />
              <div className="max-h-56 overflow-y-auto">
                {showGeneral && (
                  <DropdownMenuItem onSelect={() => selectProject(null)}>
                    <ChatBubbleLeftIcon /> 随聊
                    {projectId === null && <CheckIcon className="ml-auto" />}
                  </DropdownMenuItem>
                )}
                {projects.map((entry) => (
                  <DropdownMenuItem key={entry.id} onSelect={() => selectProject(entry.id)}>
                    {entry.remoteId ? <CloudIcon /> : <FolderIcon />}
                    <span className="truncate">{entry.name}</span>
                    {entry.id === projectId && <CheckIcon className="ml-auto" />}
                  </DropdownMenuItem>
                ))}
                {!showGeneral && !projects.length && (
                  <p className="px-2 py-2 text-ui-callout text-ink-2" role="status">
                    没有匹配的项目
                  </p>
                )}
              </div>
              {onCreateProject && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onSelect={() => defer(onCreateProject)}>
                    <FolderPlusIcon /> 创建项目
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        )}
        {permissionMode && onPermissionMode && (
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              <AdjustmentsHorizontalIcon /> 文件权限
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="w-64">
              <DropdownMenuRadioGroup
                value={permissionMode}
                onValueChange={(value) => {
                  if (value === 'restricted' || value === 'full') onPermissionMode(value);
                }}
              >
                <DropdownMenuRadioItem value="restricted">受限</DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="full">完全权限</DropdownMenuRadioItem>
              </DropdownMenuRadioGroup>
              <p className="px-2 py-2 text-ui-callout text-ink-2">
                受限只允许写入 /privacy 和
                /share，其他可见文件只读，工具不能联网。读到的内容仍会进入对话，并发送给你配置的模型。目前只有
                Linux 加 bubblewrap 能运行；Windows 和 macOS
                尚未提供，发送会失败，不会改用本机权限。完全权限沿用原来的本机权限。
              </p>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        )}
        <DropdownMenuSeparator />
        {onSelectSearch && (
          <DropdownMenuSub onOpenChange={(open) => open && onRefreshSearch()}>
            <DropdownMenuSubTrigger>
              <GlobeAltIcon /> 联网搜索
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="w-56">
              {searchEntries?.length ? (
                <DropdownMenuRadioGroup
                  value={searchSelectedId ?? ''}
                  onValueChange={(id) => onSelectSearch(id || null)}
                >
                  <DropdownMenuRadioItem value="">关闭</DropdownMenuRadioItem>
                  {searchEntries.map((entry) => (
                    <DropdownMenuRadioItem key={entry.id} value={entry.id}>
                      <span className="min-w-0 flex-1 truncate">{entry.name}</span>
                      {entry.provider === 'deepseek' && (
                        <span className="shrink-0 text-ui-subhead text-ink-2">按次计费</span>
                      )}
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              ) : searchEntries === null && !searchFailed ? (
                <DropdownMenuItem disabled>正在加载搜索配置…</DropdownMenuItem>
              ) : (
                <>
                  {searchFailed && <DropdownMenuItem disabled>搜索配置加载失败</DropdownMenuItem>}
                  <DropdownMenuItem
                    onSelect={() => navigate({ page: 'settings', section: 'capabilities' })}
                  >
                    配置搜索服务
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        )}
        <DropdownMenuSub onOpenChange={setSkillsOpen} open={skillsOpen}>
          <DropdownMenuSubTrigger>
            <WrenchScrewdriverIcon /> 技能
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="w-56 rounded-panel">
            <div className="max-h-56 overflow-y-auto">
              {visibleSkills.size ? (
                Array.from(visibleSkills, ([name, description]) => (
                  <DropdownMenuItem
                    key={name}
                    onSelect={() => defer(() => onSkill(name))}
                    title={description}
                  >
                    <DocumentTextIcon />
                    <span className="truncate">{name}</span>
                  </DropdownMenuItem>
                ))
              ) : (
                <DropdownMenuItem disabled>
                  {skills ? '没有可用技能' : isError ? '技能加载失败' : '正在加载技能…'}
                </DropdownMenuItem>
              )}
            </div>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => navigate({ page: 'settings', section: 'skills' })}>
              <AdjustmentsHorizontalIcon /> 管理技能
            </DropdownMenuItem>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <svg
              aria-hidden="true"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.5}
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M8.25 3.75v4.5m7.5-4.5v4.5M6.75 8.25h10.5v3.375a5.25 5.25 0 0 1-10.5 0V8.25ZM12 16.875v3.375" />
            </svg>
            连接器
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="w-56 rounded-panel">
            <div className="max-h-56 overflow-y-auto">
              {connectors?.length ? (
                connectors.map((app) => (
                  <DropdownMenuItem key={app.slug} onSelect={() => defer(() => onConnector(app))}>
                    <ConnectorAppIcon logo={app.logo} size="sm" />
                    <span className="truncate">{app.name}</span>
                  </DropdownMenuItem>
                ))
              ) : (
                <DropdownMenuItem disabled>
                  {connectorsFailed
                    ? '连接器加载失败'
                    : connectorsLoading
                      ? '正在加载连接器…'
                      : '暂无已连接的服务'}
                </DropdownMenuItem>
              )}
            </div>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => navigate({ page: 'connectors' })}>
              <AdjustmentsHorizontalIcon /> 管理连接器
            </DropdownMenuItem>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuItem onSelect={() => defer(onReference)}>
          <AtSymbolIcon /> 引用文件
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
