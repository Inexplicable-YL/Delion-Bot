import { useEffect, useId, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  CalendarDaysIcon,
  ChatBubbleLeftIcon as MessageSquare,
  ChevronDownIcon as ChevronDown,
  CpuChipIcon as Bot,
  DocumentTextIcon as FileText,
  EnvelopeIcon,
  FolderOpenIcon,
  GlobeAltIcon as Globe,
  InformationCircleIcon as Info,
  LinkIcon,
  ListBulletIcon,
} from '@heroicons/react/24/outline';
import { PlayIcon } from '@heroicons/react/24/solid';
import {
  useConnectorAccounts,
  useConnectorCatalog,
  type ConnectorApp,
} from '../../connectors/view';
import { cn } from '../../../ui/cn';
import { Button } from '../../../ui/button';
import type { ComposerContext } from './composer-context';
import { ChatComposerMenu } from './ChatComposerMenu';
import { ReplyCommentRail } from './reply-comment';
import { formatDuration } from './ToolTimeline';
import { openSubagent } from './tool-views';
import { BackgroundTasks } from '../../../ui/agent/background-tasks';
import { ContextIndicator } from '../../../ui/agent/context-indicator';
import {
  PromptInput,
  PromptInputAttachments,
  PromptInputChip,
  PromptInputMenu,
  PromptInputMenuItem,
  PromptInputNotice,
  PromptInputOption,
  PromptInputOptionCheck,
  PromptInputSetup,
  PromptInputSubmit,
  PromptInputToolbar,
  PromptInputTrigger,
} from '../../../ui/agent/prompt-input';
import { QueuedMessages } from '../../../ui/agent/queued-messages';
import { Popover, PopoverContent, PopoverTrigger } from '../../../ui/popover';
import { useChatTabSource } from './chat-source';
import type {
  BackgroundTaskView,
  ChatComment,
  ChatMediaView,
  ContextUsageView,
} from '../../../core/protocol/agent';
import type { LlmProviderView } from '../../../core/protocol/llm';
import { SESSION_COMMANDS } from '../../../core/protocol/agent';
import {
  CHAT_ATTACHMENT_MAX,
  chatFileKindOfFile,
  chatImageToken,
  hasChatImages,
  INLINE_IMAGE_MAX,
  matchChatImageTokens,
} from '../../../core/protocol/chat-input';
import type { ChatReference } from './use-chat';
import { ComposerEditor, type ComposerEditorHandle } from './ComposerEditor';
import { connectorPrompt } from './connector-tokens';
import { releaseChatMedia, setChatMediaPreview } from './media';
import {
  agentClient,
  capabilitiesClient,
  chatClient,
  llmClient,
  onWebSearchChanged,
} from './client';
import { errorMessage } from '../../../core/protocol/contract';

const todoPrompt = '帮我查看还未完成的个人待办';

const builtinCommands = [
  { name: '待办', prompt: todoPrompt, hint: '查询个人待办' },
  { name: '邮件', prompt: '帮我查找最近的未读邮件', hint: '通过邮箱连接器' },
  { name: '资料', prompt: '帮我在项目中查找相关文件', hint: '搜索并读取资料' },
  { name: '整理', prompt: '帮我把引用资料里的要点整理成一份笔记', hint: '生成并保存笔记' },
];

const connectorActions = [
  {
    slug: 'gmail',
    icon: EnvelopeIcon,
    label: '查看 Gmail 未读邮件',
    prompt: '帮我查看 Gmail 最近的未读邮件，并列出需要处理的事项。',
  },
  {
    slug: 'outlook',
    icon: EnvelopeIcon,
    label: '查看 Outlook 未读邮件',
    prompt: '帮我查看 Outlook 最近的未读邮件，并列出需要处理的事项。',
  },
  {
    slug: 'googlecalendar',
    icon: CalendarDaysIcon,
    label: '查看今日日程',
    prompt: '帮我查看 Google Calendar 中今天的日程，按时间排列。',
  },
  {
    slug: 'googledrive',
    icon: FolderOpenIcon,
    label: '查找 Google Drive 文件',
    prompt: '请在 Google Drive 中查找这些文件：',
  },
  {
    slug: 'slack',
    icon: MessageSquare,
    label: '搜索 Slack 消息',
    prompt: '请在 Slack 中搜索这个话题：',
  },
  {
    slug: 'notion',
    icon: FileText,
    label: '查找 Notion 页面',
    prompt: '请在 Notion 中查找这些页面：',
  },
  {
    slug: 'github',
    icon: FolderOpenIcon,
    label: '查询 GitHub 仓库',
    prompt: '请查看这个 GitHub 仓库的最新动态：',
  },
];

type MenuState = { kind: 'slash' | 'mention' | 'session'; query: string; start: number } | null;

/** 检测光标前的 /、@ 或 # 触发词；单独输入也打开候选（空查询）。「# 」是 Markdown 标题，不触发。 */
function detectMenu(text: string, caret: number): MenuState {
  const before = text.slice(0, caret);
  const slash = /(?:^|\s)\/([^\s]{0,30})$/.exec(before);
  if (slash) return { kind: 'slash', query: slash[1]!, start: caret - slash[1]!.length - 1 };
  const mention = /(?:^|\s)@([^\s@]{0,50})$/.exec(before);
  if (mention)
    return { kind: 'mention', query: mention[1]!, start: caret - mention[1]!.length - 1 };
  const session = /(?:^|\s)#([^\s#]{0,50})$/.exec(before);
  if (session)
    return { kind: 'session', query: session[1]!, start: caret - session[1]!.length - 1 };
  return null;
}

function formatSize(size: number): string {
  if (size >= 1024 * 1024) return `${(size / 1024 / 1024).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(size / 1024))} KB`;
}

/** 本会话累计缓存命中率 = cacheRead / (输入 + cacheRead)。main 没给出缓存字段（提供商不上报
 *  缓存）或分母为 0 时显示 —：写成 0% 会把「没有数据」说成「一次都没命中」。 */
export function cacheHitRateText(usage: ContextUsageView): string {
  const { inputTokens, cachedTokens } = usage;
  if (inputTokens === undefined || cachedTokens === undefined) return '—';
  const total = inputTokens + cachedTokens;
  return total > 0 ? `${((cachedTokens / total) * 100).toFixed(1)}%` : '—';
}

const webSearchOptionsKey = ['capabilities', 'webSearchOptions'];

export function ChatComposer({
  value,
  onChange,
  onSend,
  onStop,
  busy,
  configured,
  providerId = null,
  model,
  modelUnavailable = false,
  onModelSelect,
  effort,
  effortLevels,
  onEffortSelect,
  referenceOptions,
  attachments,
  comments,
  onCommentsChange,
  onAddAttachmentFile,
  onAddAttachmentView,
  onRemoveAttachment,
  contextUsage = null,
  notice = null,
  onDismissNotice,
  hero = false,
  context = null,
  onSelectProject,
  projectSwitching = false,
  hideAgentActions = false,
  sidechat = false,
  queued = [],
  onWithdrawQueued,
  tasks = [],
  onStopTask,
}: {
  /** 运行中插队、还没送达的消息；非空时显示在输入框上方，可整体撤回。 */
  queued?: string[];
  onWithdrawQueued?: () => void;
  tasks?: BackgroundTaskView[];
  onStopTask?: (taskId: string) => void;
  /** 旁问输入框：模型与思考强度沿用主会话、联网搜索是全局开关，这三个选择器都不显示。 */
  sidechat?: boolean;
  context?: ComposerContext | null;
  onSelectProject?: (projectId: string | null) => void;
  projectSwitching?: boolean;
  hideAgentActions?: boolean;
  notice?: string | null;
  onDismissNotice?: () => void;
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
  onStop: () => void;
  busy: boolean;
  configured: boolean;
  providerId?: string | null;
  model: string;
  /** 会话的模型已停用或被移除：禁止发送，提示另选。 */
  modelUnavailable?: boolean;
  onModelSelect: (provider: LlmProviderView, model: string) => void;
  /** 当前推理强度档位；未配置时为 null，显示 default 并提供设置入口。 */
  effort: string | null;
  effortLevels: string[];
  onEffortSelect: (level: string) => void;
  referenceOptions: ChatReference[];
  attachments: ChatMediaView[];
  comments: ChatComment[];
  onCommentsChange: (comments: ChatComment[]) => void;
  onAddAttachmentFile: (file: File) => Promise<void>;
  onAddAttachmentView: (view: ChatMediaView) => void;
  onRemoveAttachment: (id: string) => void;
  contextUsage?: ContextUsageView | null;
  hero?: boolean;
}) {
  const { navigate } = useChatTabSource();
  const editorRef = useRef<ComposerEditorHandle | null>(null);
  const promptRef = useRef<HTMLDivElement>(null);
  const [wrapped, setWrapped] = useState(false);
  const expanded = value.length > 0 && (wrapped || value.includes('\n'));
  const [menu, setMenu] = useState<MenuState>(null);
  const [index, setIndex] = useState(0);
  // 菜单 id 逐实例唯一：同页可同时挂多个会话的 composer。
  const menuListId = `${useId()}-list`;
  const menuOptionId = (position: number) => `${menuListId}-option-${position}`;
  const [dragging, setDragging] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const customCommands = useQuery({
    queryKey: ['settings', 'commands'],
    queryFn: () => agentClient['list-commands']({}),
  }).data;
  // 两列模型面板：打开时重读设置配置保证新鲜；focusedId 是左列手动查看的提供商，空则跟随当前使用项。
  const [modelPickerOpen, setModelPickerOpen] = useState(false);
  const providerQuery = useQuery({
    queryKey: ['llm', 'providers'],
    queryFn: () => llmClient.list(),
    enabled: Boolean(window.delionBot) && modelPickerOpen,
  });
  const providers = providerQuery.data?.filter((view) => view.enabled) ?? null;
  const providersFailed = providerQuery.isError;
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const focused =
    providers?.find((provider) => provider.id === focusedId) ??
    providers?.find((provider) => provider.id === providerId) ??
    providers?.[0] ??
    null;
  const [effortPickerOpen, setEffortPickerOpen] = useState(false);
  const searchQuery = useQuery({
    queryKey: webSearchOptionsKey,
    queryFn: () => capabilitiesClient.listWebSearchOptions(),
    enabled: !sidechat && Boolean(window.delionBot),
  });
  const searchEntries = searchQuery.data?.entries ?? null;
  const searchSelectedId = searchQuery.data?.selectedId ?? null;
  const searchFailed = searchQuery.isError;
  const showAgentActions = hero && configured && !modelUnavailable && !hideAgentActions;
  const { configured: connectorsConfigured, accounts } = useConnectorAccounts();
  const [connectorOrder] = useState(() =>
    connectorActions
      .map((action) => ({ action, order: Math.random() }))
      .sort((left, right) => left.order - right.order)
      .map(({ action }) => action),
  );
  const connectedApps = new Set(
    (connectorsConfigured.data ? accounts.data : undefined)
      ?.filter(({ status }) => status === 'ACTIVE')
      .map(({ toolkit }) => toolkit.slug),
  );
  const connectorCatalog = useConnectorCatalog(
    connectorsConfigured.data === true && connectedApps.size > 0,
  );
  const availableConnectors = connectorCatalog.data?.filter(({ slug }) => connectedApps.has(slug));
  const connectorsFailed =
    connectorsConfigured.isError || accounts.isError || connectorCatalog.isError;
  const connectorsLoading =
    connectorsConfigured.isFetching || accounts.isFetching || connectorCatalog.isFetching;
  const { data: capabilities } = useQuery({
    queryKey: ['capabilities', 'builtin'],
    queryFn: () => capabilitiesClient.listBuiltinCapabilities(),
    enabled: showAgentActions && Boolean(window.delionBot),
  });
  const { data: skills } = useQuery({
    queryKey: ['capabilities', 'skills'],
    queryFn: () => capabilitiesClient.listSkills(),
    enabled: showAgentActions && !context?.remote && Boolean(window.delionBot),
  });
  const agentActions = [
    ...connectorOrder.map((action) => ({ ...action, available: connectedApps.has(action.slug) })),
    {
      icon: ListBulletIcon,
      label: '查看待办',
      prompt: todoPrompt,
      available:
        !context?.remote &&
        capabilities?.some(({ name, enabled }) => name === 'bash' && enabled) &&
        skills?.some(
          ({ name, origin, enabled }) => name === 'todo' && origin === 'builtin' && enabled,
        ),
    },
    {
      icon: LinkIcon,
      label: '总结网页',
      prompt: '请阅读并总结这个网页：',
      available: capabilities?.some(({ name, enabled }) => name === 'web_fetch' && enabled),
    },
    {
      icon: Globe,
      label: '搜索网络',
      prompt: '请联网搜索：',
      available: searchSelectedId !== null,
    },
  ]
    .filter(({ available }) => available)
    .slice(0, 3);
  // 先取消在途读取：首次读取还没回来时，失效不会重读，旧响应会盖掉新配置。
  const refreshSearch = async () => {
    await queryClient.cancelQueries({ queryKey: webSearchOptionsKey });
    await queryClient.invalidateQueries({ queryKey: webSearchOptionsKey });
  };
  useEffect(() => onWebSearchChanged(() => void refreshSearch()), []);

  useEffect(() => {
    const prompt = promptRef.current;
    const editor = prompt?.querySelector<HTMLElement>('.cm-content');
    const toolbar = prompt?.querySelector<HTMLElement>('[data-slot="prompt-input-toolbar"]');
    const add = prompt?.querySelector<HTMLElement>('[data-slot="composer-add"]');
    if (!prompt || !editor || !toolbar || !add) return;

    const lineContents = document.createRange();
    const measure = () => {
      const line = editor.querySelector<HTMLElement>('.cm-line');
      if (!line || !prompt.clientWidth) return;
      const { paddingLeft, paddingRight, columnGap } = getComputedStyle(prompt);
      // 展开后仍按单行布局的宽度测量，避免文本在两种布局间反复换行。
      const inlineWidth =
        prompt.clientWidth -
        parseFloat(paddingLeft) -
        parseFloat(paddingRight) -
        add.offsetWidth -
        toolbar.offsetWidth -
        2 * parseFloat(columnGap);
      lineContents.selectNodeContents(line);
      setWrapped(
        line.getBoundingClientRect().height >
          Math.ceil(parseFloat(getComputedStyle(line).lineHeight)) ||
          lineContents.getBoundingClientRect().width > inlineWidth,
      );
    };
    const contentObserver = new MutationObserver(measure);
    contentObserver.observe(editor, { childList: true, subtree: true, characterData: true });
    const sizeObserver = new ResizeObserver(measure);
    for (const element of [prompt, editor, toolbar, add]) sizeObserver.observe(element);
    return () => {
      contentObserver.disconnect();
      sizeObserver.disconnect();
    };
  }, []);

  const slashItems =
    menu?.kind === 'slash'
      ? [
          ...builtinCommands,
          ...(customCommands ?? []).map((command) => ({ ...command, hint: '自定义' })),
          // Delion Bot 的会话命令：插入 `/name ` 留给参数，发送时由 use-chat 拦下执行。
          // 旁问里没有会话命令：发出去就是普通提问。
          ...(sidechat ? [] : SESSION_COMMANDS).map((command) => ({
            name: command.name,
            prompt: `/${command.name} `,
            hint: ['argumentHint' in command ? command.argumentHint : '', command.description]
              .filter(Boolean)
              .join(' · '),
          })),
        ].filter((command) => command.name.includes(menu.query))
      : [];
  const mentionItems =
    menu && menu.kind !== 'slash'
      ? referenceOptions
          .filter(
            (option) =>
              Boolean(option.session) === (menu.kind === 'session') &&
              option.title.toLowerCase().includes(menu.query.toLowerCase()),
          )
          .slice(0, 8)
      : [];
  const items: (typeof slashItems)[number][] | ChatReference[] =
    menu?.kind === 'slash' ? slashItems : mentionItems;
  const menuOpen = menu !== null && items.length > 0;

  const handleCaret = (text: string, caret: number) => {
    if (fileError) setFileError(null);
    const next = detectMenu(text, caret);
    const kindChanged = next?.kind !== menu?.kind;
    const queryChanged = next?.query !== menu?.query;
    if (kindChanged || queryChanged) setIndex(0);
    setMenu(next);
  };

  const handleSelect = (position: number) => {
    if (!menu) return;
    const caret = editorRef.current?.selectionStart() ?? value.length;
    if (menu.kind === 'slash') {
      const command = slashItems[position];
      if (!command) return;
      editorRef.current?.replaceRange(menu.start, caret, command.prompt);
    } else {
      const option = mentionItems[position];
      if (!option) return;
      // 引用即文本：原位留下「@相对路径」或「#会话标题」token（尾随空格隔开后续输入），发送时解析回 key。
      editorRef.current?.replaceRange(
        menu.start,
        caret,
        `${option.session ? '#' : '@'}${option.title} `,
      );
    }
    setMenu(null);
    setIndex(0);
    editorRef.current?.focus();
  };

  const insertMention = () => {
    const caret = editorRef.current?.selectionStart() ?? value.length;
    const prefix = caret > 0 && !/\s/.test(value[caret - 1]!) ? ' ' : '';
    editorRef.current?.insertAt(caret, `${prefix}@`);
    editorRef.current?.focus();
  };

  const insertConnector = (app: ConnectorApp) => {
    const caret = editorRef.current?.selectionStart() ?? value.length;
    const prefix = caret > 0 && !/\s/.test(value[caret - 1]!) ? ' ' : '';
    editorRef.current?.insertAt(caret, `${prefix}${connectorPrompt(app)} `);
    editorRef.current?.focus();
  };

  const appendPrompt = (prompt: string) => {
    editorRef.current?.insertAt(value.length, `${value.trim() ? '\n\n' : ''}${prompt}`);
    editorRef.current?.focus();
  };

  /** 插入一张已暂存的内联图片 token，返回新的插入位置（批量拖入时逐张顺延）。 */
  const insertImageView = (view: ChatMediaView, pos: number) => {
    setChatMediaPreview(view.id, view.previewUrl);
    const token = `${chatImageToken(view.id, view.name)} `;
    editorRef.current?.insertAt(pos, token);
    return pos + token.length;
  };

  const addFiles = async (files: File[], pos: number) => {
    if (!window.delionBot) return;
    let insertPos = pos;
    // 闭包里的 value 不含本轮已插入的 token，循环内自计数防止批量拖入绕过上限。
    let imageCount = matchChatImageTokens(value).length;
    let attachmentCount = attachments.length;
    for (const file of files) {
      const kind = await chatFileKindOfFile(file);
      if (kind === 'image' && imageCount >= INLINE_IMAGE_MAX) {
        setFileError(`最多插入 ${INLINE_IMAGE_MAX} 张图片`);
        continue;
      }
      if (kind !== 'image' && attachmentCount >= CHAT_ATTACHMENT_MAX) {
        setFileError(`附件最多 ${CHAT_ATTACHMENT_MAX} 个`);
        continue;
      }
      try {
        if (kind === 'image') {
          const bytes = new Uint8Array(await file.arrayBuffer());
          const view = await agentClient['stage-media']({ name: file.name, bytes });
          insertPos = insertImageView(view, insertPos);
          imageCount += 1;
        } else {
          await onAddAttachmentFile(file);
          attachmentCount += 1;
        }
        setFileError(null);
      } catch (e) {
        setFileError(errorMessage(e));
      }
    }
  };

  const pickFiles = () => {
    if (!window.delionBot) return;
    void chatClient
      .pickMedia()
      .then((views) => {
        let insertPos = editorRef.current?.selectionStart() ?? value.length;
        let imageCount = matchChatImageTokens(value).length;
        let attachmentCount = attachments.length;
        for (const view of views) {
          try {
            if (view.kind === 'image') {
              if (imageCount >= INLINE_IMAGE_MAX) {
                setFileError(`最多插入 ${INLINE_IMAGE_MAX} 张图片`);
                releaseChatMedia([view.id]);
                continue;
              }
              insertPos = insertImageView(view, insertPos);
              imageCount += 1;
            } else if (attachmentCount >= CHAT_ATTACHMENT_MAX) {
              releaseChatMedia([view.id]);
              setFileError(`附件最多 ${CHAT_ATTACHMENT_MAX} 个`);
            } else {
              onAddAttachmentView(view);
              attachmentCount += 1;
            }
          } catch (error) {
            releaseChatMedia([view.id]);
            setFileError(errorMessage(error));
          }
        }
      })
      .catch((e) => setFileError(errorMessage(e)));
  };

  const menuApi = {
    onKey: (key: 'down' | 'up' | 'select' | 'close'): boolean => {
      if (!menuOpen) return false;
      if (key === 'close') {
        setMenu(null);
        setIndex(0);
        return true;
      }
      if (key === 'down') {
        setIndex((current) => (current + 1) % items.length);
        return true;
      }
      if (key === 'up') {
        setIndex((current) => (current - 1 + items.length) % items.length);
        return true;
      }
      handleSelect(index);
      return true;
    },
  };

  const canSend =
    value.trim().length > 0 ||
    hasChatImages(value) ||
    attachments.length > 0 ||
    comments.length > 0;

  const sendable = configured && !modelUnavailable && !projectSwitching && canSend;
  // 主会话运行中输入框有内容就是插队发送；旁问不插队，运行中始终是停止。
  const stoppable = busy && (sidechat || !canSend);

  const openModelPicker = (open: boolean) => {
    setModelPickerOpen(open);
    if (open) setFocusedId(null);
  };

  const selectSearchEntry = async (id: string | null) => {
    if (!window.delionBot) return;
    try {
      await capabilitiesClient.selectWebSearchEntry(id);
      void refreshSearch();
    } catch (cause) {
      setFileError(errorMessage(cause));
    }
  };

  return (
    <div className="relative">
      {queued.length > 0 && (
        <QueuedMessages
          messages={queued.map((text) => text.trim() || '图片或附件')}
          onWithdraw={onWithdrawQueued}
        />
      )}
      {(fileError ?? notice) && (
        <PromptInputNotice
          message={(fileError ?? notice)!}
          onDismiss={fileError ? () => setFileError(null) : onDismissNotice}
        />
      )}
      <PromptInput
        ref={promptRef}
        className="flex flex-wrap items-center gap-2 px-2 py-2.5"
        dragging={dragging}
        dropHint="松开以添加图片或附件"
        material="glass"
        onDragOver={(event) => {
          if (event.dataTransfer.types.includes('Files')) {
            event.preventDefault();
            setDragging(true);
          }
        }}
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false);
        }}
        onDrop={(event) => {
          setDragging(false);
          const files = [...(event.dataTransfer?.files ?? [])];
          if (!files.length) return;
          event.preventDefault();
          void addFiles(files, editorRef.current?.selectionStart() ?? value.length);
        }}
      >
        {(comments.length > 0 || attachments.length > 0) && (
          <PromptInputAttachments className="-order-2 min-w-0 basis-full p-2">
            {comments.length > 0 && (
              <ReplyCommentRail comments={comments} onChange={onCommentsChange} />
            )}
            {attachments.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {attachments.map((item) => (
                  <PromptInputChip
                    detail={formatSize(item.size)}
                    icon={<FileText />}
                    key={item.id}
                    label={item.name}
                    onRemove={() => onRemoveAttachment(item.id)}
                    removeLabel={`移除附件 ${item.name}`}
                  />
                ))}
              </div>
            )}
          </PromptInputAttachments>
        )}
        <ComposerEditor
          className={cn(
            'min-w-0',
            expanded
              ? 'basis-full px-2 py-1'
              : 'flex-1 @max-sm:basis-full @max-sm:px-2 @max-sm:py-1',
          )}
          handleRef={editorRef}
          menu={menuApi}
          menuAria={{
            activeId: menuOpen && index < items.length ? menuOptionId(index) : null,
            listId: menuListId,
            open: menuOpen,
          }}
          onChange={onChange}
          onCaret={handleCaret}
          onDropHandled={() => setDragging(false)}
          onFiles={(files, pos) => void addFiles(files, pos)}
          onSend={() => {
            if (canSend && !modelUnavailable) onSend();
          }}
          placeholderText={sidechat ? '顺便问一句…' : '有什么可以帮你？'}
          referenceOptions={referenceOptions}
          connectorApps={connectorCatalog.data}
          value={value}
        />
        <ChatComposerMenu
          className={expanded ? '' : '-order-1 @max-sm:order-none'}
          allowProjectSwitch={hero}
          projectId={context?.projectId ?? null}
          onSelectProject={onSelectProject}
          projectSwitching={projectSwitching}
          connectors={availableConnectors}
          connectorsFailed={connectorsFailed}
          connectorsLoading={connectorsLoading}
          onConnector={insertConnector}
          onReference={insertMention}
          onSkill={(name) => appendPrompt(`请使用 ${name} 技能。`)}
          onUpload={pickFiles}
          searchEntries={searchEntries}
          searchFailed={searchFailed}
          searchSelectedId={searchSelectedId}
          onRefreshSearch={() => void refreshSearch()}
          onSelectSearch={sidechat ? undefined : (id) => void selectSearchEntry(id)}
        />
        <PromptInputToolbar className="ml-auto min-w-0 shrink-0 justify-end">
          {tasks.length > 0 && onStopTask && (
            <BackgroundTasks
              formatElapsed={formatDuration}
              onOpenSubagent={(taskId) => void openSubagent(taskId, navigate)}
              onStop={onStopTask}
              tasks={tasks}
            />
          )}
          {configured && contextUsage && (
            <ContextIndicator cacheHitRate={cacheHitRateText(contextUsage)} usage={contextUsage} />
          )}
          {configured && !sidechat && (
            <Popover onOpenChange={openModelPicker} open={modelPickerOpen}>
              <PopoverTrigger asChild>
                <PromptInputTrigger
                  aria-label="模型服务"
                  className={cn(
                    '@max-[220px]:px-1.5',
                    'max-w-40',
                    modelUnavailable && 'text-danger hover:text-danger',
                  )}
                  title={modelUnavailable ? `${model}（已停用或被移除，请另选模型）` : model}
                >
                  <span className="truncate @max-[220px]:hidden">
                    {modelUnavailable ? `${model} · 已停用` : model}
                  </span>
                  <Bot className="hidden size-4 @max-[220px]:block" />
                  <ChevronDown className="size-4 @max-[220px]:hidden" />
                </PromptInputTrigger>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-80" side="bottom">
                {providers === null ? (
                  providersFailed ? (
                    <p className="px-2 py-3 text-ui-subhead text-ink-2">模型列表加载失败</p>
                  ) : (
                    <p className="px-2 py-3 text-ui-subhead text-ink-2">正在加载模型列表…</p>
                  )
                ) : providers.length === 0 ? (
                  <PromptInputSetup
                    actionLabel="打开设置 › 模型服务"
                    message="还没有启用的模型供应商，可在设置 › 模型服务 中添加或启用。"
                    onAction={() => {
                      setModelPickerOpen(false);
                      navigate({ page: 'settings', section: 'providers' });
                    }}
                  />
                ) : (
                  <div className="flex gap-0.5">
                    <ul aria-label="模型服务" className="max-h-64 w-28 shrink-0 overflow-y-auto">
                      {providers.map((provider) => (
                        <li key={provider.id}>
                          <PromptInputOption
                            active={provider.id === focused?.id}
                            onClick={() => setFocusedId(provider.id)}
                          >
                            <span className="truncate">{provider.name}</span>
                            {provider.id === providerId && (
                              <span
                                aria-label="本会话使用"
                                className="ms-auto size-1.5 shrink-0 rounded-full bg-success"
                                title="本会话使用"
                              />
                            )}
                          </PromptInputOption>
                        </li>
                      ))}
                    </ul>
                    <ul
                      aria-label="模型"
                      className="max-h-64 min-w-0 flex-1 overflow-y-auto border-l border-line pl-1.5"
                    >
                      {focused?.models.map((item) => (
                        <li key={item}>
                          <PromptInputOption
                            active={focused.id === providerId && model === item}
                            onClick={() => {
                              setModelPickerOpen(false);
                              onModelSelect(focused, item);
                            }}
                          >
                            <span className="truncate">{item}</span>
                            {focused.id === providerId && model === item && (
                              <PromptInputOptionCheck />
                            )}
                          </PromptInputOption>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </PopoverContent>
            </Popover>
          )}
          {configured && !sidechat && (
            <Popover onOpenChange={setEffortPickerOpen} open={effortPickerOpen}>
              <PopoverTrigger asChild>
                <PromptInputTrigger
                  aria-label="思考强度"
                  className="@max-[260px]:px-1.5 @max-[160px]:hidden"
                  title="思考强度"
                >
                  <span className="truncate @max-[260px]:hidden">{effort ?? 'default'}</span>
                  <Info className="hidden size-4 @max-[260px]:block" />
                  <ChevronDown className="size-4 @max-[260px]:hidden" />
                </PromptInputTrigger>
              </PopoverTrigger>
              <PopoverContent
                align="end"
                className={effortLevels.length ? 'w-32' : 'w-80'}
                side="bottom"
              >
                {effortLevels.length === 0 ? (
                  <PromptInputSetup
                    actionLabel="打开设置 › 模型服务"
                    message="当前模型尚未配置可选的思考强度档位。在设置中编辑当前模型，勾选其支持的档位并保存。"
                    onAction={() => {
                      setEffortPickerOpen(false);
                      navigate({ page: 'settings', section: 'providers' });
                    }}
                  />
                ) : (
                  <ul aria-label="思考强度">
                    {effortLevels.map((level) => (
                      <li key={level}>
                        <PromptInputOption
                          active={level === effort}
                          onClick={() => {
                            setEffortPickerOpen(false);
                            onEffortSelect(level);
                          }}
                        >
                          <span className="truncate">{level}</span>
                          {level === effort && <PromptInputOptionCheck />}
                        </PromptInputOption>
                      </li>
                    ))}
                  </ul>
                )}
              </PopoverContent>
            </Popover>
          )}
          <PromptInputSubmit
            onSend={onSend}
            onStop={onStop}
            sendable={sendable}
            sendTitle={modelUnavailable ? '这个会话的模型已停用，请先另选模型' : '发送'}
            stoppable={stoppable}
          />
        </PromptInputToolbar>
        {menuOpen && (
          <PromptInputMenu activeIndex={index} id={menuListId} itemCount={items.length}>
            {items.map((item, position) => (
              <PromptInputMenuItem
                icon={
                  menu?.kind === 'mention' ? (
                    <FileText className="size-4 shrink-0 text-ink-2" />
                  ) : menu?.kind === 'session' ? (
                    <MessageSquare className="size-4 shrink-0 text-ink-2" />
                  ) : (
                    <span className="shrink-0 font-mono text-ui-body text-ink-2">/</span>
                  )
                }
                id={menuOptionId(position)}
                key={'name' in item ? item.name : item.key}
                onHover={() => setIndex(position)}
                onSelect={() => handleSelect(position)}
                selected={position === index}
              >
                {'name' in item ? (
                  <>
                    <span className="shrink-0 text-ui-headline text-ink">/{item.name}</span>
                    <span className="min-w-0 flex-1 truncate text-ui-subhead text-ink-2">
                      {item.hint}
                    </span>
                  </>
                ) : item.session ? (
                  <span
                    className="min-w-0 flex-1 truncate text-ui-headline"
                    style={{ color: 'var(--accent-ink)' }}
                  >
                    {item.title}
                  </span>
                ) : (
                  <MentionTitle title={item.title} />
                )}
              </PromptInputMenuItem>
            ))}
          </PromptInputMenu>
        )}
      </PromptInput>
      {showAgentActions && agentActions.length > 0 && (
        <div
          className={cn(
            'mt-app-gap grid gap-1 pl-1',
            (value.length > 0 || attachments.length > 0 || comments.length > 0) && 'invisible',
          )}
        >
          {agentActions.map(({ icon: Icon, label, prompt }) => (
            <Button
              className="group h-row-regular w-full justify-start gap-3 rounded-control px-3 text-ui-body focus-visible:bg-hover focus-visible:text-ink"
              key={label}
              onClick={() => appendPrompt(prompt)}
              variant="ghost"
            >
              <span aria-hidden className="grid size-5 shrink-0 place-items-center">
                <Icon className="size-5 group-hover:hidden group-focus-visible:hidden" />
                <PlayIcon className="hidden size-5 text-accent-ink group-hover:block group-focus-visible:block" />
              </span>
              {label}
            </Button>
          ))}
        </div>
      )}
    </div>
  );
}

function MentionTitle({ title }: { title: string }) {
  const at = title.lastIndexOf('/');
  const dir = at < 0 ? '' : title.slice(0, at + 1);
  const name = at < 0 ? title : title.slice(at + 1);
  return (
    <span className="flex min-w-0 flex-1 items-baseline gap-1.5 text-ui-body">
      <span className="shrink-0 font-semibold" style={{ color: 'var(--accent-ink)' }}>
        {name}
      </span>
      {dir && <span className="min-w-0 truncate text-ui-subhead text-ink-2">{dir}</span>}
    </span>
  );
}
