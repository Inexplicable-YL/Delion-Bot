import { useId, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowPathIcon,
  ArrowsPointingInIcon,
  CalendarDaysIcon,
  ChatBubbleLeftEllipsisIcon,
  CommandLineIcon,
  ChatBubbleLeftIcon as MessageSquare,
  DocumentTextIcon as FileText,
  EnvelopeIcon,
  FolderOpenIcon,
  GlobeAltIcon as Globe,
  LinkIcon,
  ListBulletIcon,
  PencilSquareIcon,
  PhotoIcon,
  PlusIcon,
  TagIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';
import { PlayIcon } from '@heroicons/react/24/solid';
import {
  useConnectorAccounts,
  useConnectorCatalog,
  type ConnectorApp,
} from '../../connectors/view';
import { cn } from '../../../ui/cn';
import { Button } from '../../../ui/Button';
import { FileIcon } from '../../../ui/FileIcon';
import { IconButton } from '../../../ui/IconButton';
import { formatBytes } from '../../../ui/format-bytes';
import type { ComposerContext } from './composer-context';
import { ChatComposerMenu } from './ChatComposerMenu';
import { ChatModelPicker } from './ChatModelPicker';
import { ChatPermissionPicker } from './ChatPermissionPicker';
import { ReplyCommentRail } from './ReplyComment';
import { formatDuration } from './ToolTimeline';
import { openSubagent } from './ToolViews';
import { BackgroundTasks } from '../../../ui/agent/BackgroundTasks';
import { ContextIndicator } from '../../../ui/agent/ContextIndicator';
import {
  PromptInput,
  PromptInputAttachments,
  PromptInputMenu,
  PromptInputMenuItem,
  PromptInputNotice,
  PromptInputSubmit,
  PromptInputToolbar,
} from '../../../ui/agent/PromptInput';
import { QueuedMessages } from '../../../ui/agent/QueuedMessages';
import { useChatTabSource } from './ChatSource';
import type {
  BackgroundTaskView,
  ChatComment,
  ChatMediaView,
  ContextUsageView,
  PermissionMode,
} from '../../../core/protocol/agent';
import type { LlmProviderView } from '../../../core/protocol/llm';
import { SESSION_COMMANDS, type SessionCommandName } from '../../../core/protocol/agent';
import {
  CHAT_ATTACHMENT_MAX,
  chatFileKindOfFile,
  chatImageToken,
  INLINE_IMAGE_MAX,
  matchChatImageTokens,
  parseChatBlocks,
  stripChatImageTokens,
} from '../../../core/protocol/chat-input';
import type { ChatReference } from './use-chat';
import { ComposerEditor, type ComposerEditorHandle } from './ComposerEditor';
import { ImageViewer } from './ReplyImageViewer';
import { chatMediaUrl } from './reply-images';
import { connectorPrompt } from './connector-tokens';
import {
  fetchChatMediaPreview,
  getChatMediaPreview,
  releaseChatMedia,
  setChatMediaPreview,
} from './media';
import { agentClient, capabilitiesClient, chatClient, onWebSearchChanged } from './client';
import { errorMessage } from '../../../core/protocol/contract';

const todoPrompt = '帮我查看还未完成的个人待办';

const builtinCommands = [
  { name: '待办', prompt: todoPrompt, hint: '查询个人待办', icon: ListBulletIcon },
  { name: '邮件', prompt: '帮我查找最近的未读邮件', hint: '通过邮箱连接器', icon: EnvelopeIcon },
  {
    name: '资料',
    prompt: '帮我在项目中查找相关文件',
    hint: '搜索并读取资料',
    icon: FolderOpenIcon,
  },
  {
    name: '整理',
    prompt: '帮我把引用资料里的要点整理成一份笔记',
    hint: '生成并保存笔记',
    icon: PencilSquareIcon,
  },
];

const sessionCommandIcons: Record<SessionCommandName, typeof CommandLineIcon> = {
  compact: ArrowsPointingInIcon,
  autocompact: ArrowsPointingInIcon,
  reload: ArrowPathIcon,
  name: TagIcon,
  new: PlusIcon,
  btw: ChatBubbleLeftEllipsisIcon,
};

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

export function cacheHitRateText(usage: ContextUsageView): string {
  const { inputTokens, cachedTokens } = usage;
  if (inputTokens === undefined || cachedTokens === undefined) return '—';
  const total = inputTokens + cachedTokens;
  return total > 0 ? `${((cachedTokens / total) * 100).toFixed(1)}%` : '—';
}

const webSearchOptionsKey = ['capabilities', 'webSearchOptions'];
const attachmentRemoveVisibility =
  'pointer-events-none opacity-0 group-hover:pointer-events-auto group-hover:opacity-100 focus-visible:pointer-events-auto focus-visible:opacity-100 touch:pointer-events-auto touch:opacity-100';

function ComposerImage({
  id,
  name,
  onOpen,
  onRemove,
}: {
  id: string;
  name: string;
  onOpen: () => void;
  onRemove: () => void;
}) {
  const { data: url } = useQuery({
    queryKey: ['chat', 'media', id],
    queryFn: () => fetchChatMediaPreview(id),
    initialData: getChatMediaPreview(id),
    staleTime: Infinity,
  });
  return (
    <div className="group relative size-14 shrink-0 select-none">
      {url ? (
        <button
          aria-label={`放大查看 ${name}`}
          className="block size-full cursor-zoom-in overflow-hidden rounded-chip border border-line"
          onClick={onOpen}
          type="button"
        >
          <img alt={name} className="size-full object-cover" draggable={false} src={url} />
        </button>
      ) : (
        <div
          className="grid size-full place-items-center rounded-chip border border-line bg-inset text-ink-2"
          role="img"
          aria-label={name}
        >
          <PhotoIcon className="size-5" />
        </div>
      )}
      <IconButton
        aria-label={`移除图片 ${name}`}
        className={cn(
          'absolute top-0 right-0 rounded-pill hover:bg-transparent [&_svg]:size-3',
          attachmentRemoveVisibility,
        )}
        onClick={onRemove}
        onMouseDown={(event) => event.preventDefault()}
        size="xs"
      >
        <span className="grid size-badge place-items-center rounded-pill bg-surface shadow-hairline">
          <XMarkIcon />
        </span>
      </IconButton>
    </div>
  );
}

export function ChatComposer({
  value: draft,
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
  permissionMode = null,
  onPermissionMode,
}: {
  queued?: string[];
  onWithdrawQueued?: () => void;
  tasks?: BackgroundTaskView[];
  onStopTask?: (taskId: string) => void;
  permissionMode?: PermissionMode | null;
  onPermissionMode?: (mode: PermissionMode) => void;
  sidechat?: boolean;
  context?: ComposerContext | null;
  onSelectProject?: (projectId: string | null) => void;
  projectSwitching?: boolean;
  hideAgentActions?: boolean;
  notice?: string | null;
  onDismissNotice?: () => void;
  value: string;
  onChange: (update: (current: string) => string) => void;
  onSend: () => void;
  onStop: () => void;
  busy: boolean;
  configured: boolean;
  providerId?: string | null;
  model: string;
  modelUnavailable?: boolean;
  onModelSelect: (provider: LlmProviderView, model: string) => void;
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
  const [wrapped, setWrapped] = useState(false);
  const images = matchChatImageTokens(draft);
  const value = images.length
    ? parseChatBlocks(draft)
        .map((block) => (block.type === 'text' ? block.text : ''))
        .join('')
    : draft;
  const hasMedia = images.length > 0 || attachments.length > 0;
  const expanded = hasMedia || (value.length > 0 && (wrapped || value.includes('\n')));
  const [menu, setMenu] = useState<MenuState>(null);
  const [index, setIndex] = useState(0);
  const menuListId = `${useId()}-list`;
  const menuOptionId = (position: number) => `${menuListId}-option-${position}`;
  const [dragging, setDragging] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState<{ id: string; name: string } | null>(null);
  const queryClient = useQueryClient();
  const customCommands = useQuery({
    queryKey: ['settings', 'commands'],
    queryFn: () => agentClient['list-commands']({}),
  }).data;
  const searchQuery = useQuery({
    queryKey: webSearchOptionsKey,
    queryFn: () => capabilitiesClient.listWebSearchOptions(),
    enabled: !sidechat && Boolean(window.delionBot),
  });
  const searchEntries = searchQuery.data?.entries ?? null;
  const searchSelectedId = searchQuery.data?.selectedId ?? null;
  const searchFailed = searchQuery.isError;
  const showAgentActions = hero && configured && !modelUnavailable && !hideAgentActions;
  const {
    status: connectorStatus,
    provider: connectorProvider,
    configured: connectorsConfigured,
    accounts,
  } = useConnectorAccounts();
  const [connectorOrder] = useState(() =>
    connectorActions
      .map((action) => ({ action, order: Math.random() }))
      .sort((left, right) => left.order - right.order)
      .map(({ action }) => action),
  );
  const connectedApps = new Set(
    (connectorsConfigured ? accounts.data : undefined)
      ?.filter(({ status }) => status === 'ACTIVE')
      .map(({ toolkit }) => toolkit.slug),
  );
  const connectorCatalog = useConnectorCatalog(connectorsConfigured && connectedApps.size > 0);
  const availableConnectors = connectorCatalog.data?.filter(({ slug }) => connectedApps.has(slug));
  const connectorsFailed = connectorStatus.isError || accounts.isError || connectorCatalog.isError;
  const connectorsLoading =
    connectorStatus.isFetching || accounts.isFetching || connectorCatalog.isFetching;
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
  const refreshSearch = async () => {
    await queryClient.cancelQueries({ queryKey: webSearchOptionsKey });
    await queryClient.invalidateQueries({ queryKey: webSearchOptionsKey });
  };
  const mountPrompt = (prompt: HTMLDivElement | null) => {
    if (!prompt) return;
    const unsubscribe = onWebSearchChanged(() => void refreshSearch());
    const editor = prompt.querySelector<HTMLElement>('.cm-content');
    const toolbar = prompt?.querySelector<HTMLElement>('[data-slot="prompt-input-toolbar"]');
    const add = prompt?.querySelector<HTMLElement>('[data-slot="composer-add"]');
    if (!editor || !toolbar || !add) return unsubscribe;

    const lineContents = document.createRange();
    const measure = () => {
      const line = editor.querySelector<HTMLElement>('.cm-line');
      if (!line || !prompt.clientWidth) return;
      const permission = prompt.querySelector<HTMLElement>('[data-slot="composer-permission"]');
      const modelName = toolbar.querySelector<HTMLElement>('[data-slot="composer-model-name"]');
      const { paddingLeft, paddingRight, columnGap } = getComputedStyle(prompt);
      const inlineWidth =
        prompt.clientWidth -
        parseFloat(paddingLeft) -
        parseFloat(paddingRight) -
        add.offsetWidth -
        toolbar.offsetWidth +
        (modelName?.offsetWidth
          ? modelName.offsetWidth + parseFloat(getComputedStyle(modelName.parentElement!).columnGap)
          : 0) -
        (permission ? permission.offsetWidth + parseFloat(columnGap) : 0) -
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
      unsubscribe();
    };
  };

  const slashItems =
    menu?.kind === 'slash'
      ? [
          ...builtinCommands,
          ...(customCommands ?? []).map((command) => ({
            ...command,
            hint: '自定义',
            icon: CommandLineIcon,
          })),
          ...(sidechat ? [] : SESSION_COMMANDS).map((command) => ({
            name: command.name,
            prompt: `/${command.name} `,
            icon: sessionCommandIcons[command.name],
            argumentHint: 'argumentHint' in command ? command.argumentHint : undefined,
            hint: command.description,
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
    if (!connectorProvider) return;
    editorRef.current?.insertAt(caret, `${prefix}${connectorPrompt(app, connectorProvider)} `);
    editorRef.current?.focus();
  };

  const appendPrompt = (prompt: string) => {
    editorRef.current?.insertAt(value.length, `${value.trim() ? '\n\n' : ''}${prompt}`);
    editorRef.current?.focus();
  };

  const addImageView = (view: ChatMediaView) => {
    setChatMediaPreview(view.id, view.previewUrl);
    onChange((current) => current + chatImageToken(view.id, view.name));
  };

  const addFiles = async (files: File[]) => {
    if (!window.delionBot) return;
    let imageCount = images.length;
    let attachmentCount = attachments.length;
    for (const file of files) {
      const kind = await chatFileKindOfFile(file);
      if (kind === 'image' && imageCount >= INLINE_IMAGE_MAX) {
        setFileError(`最多添加 ${INLINE_IMAGE_MAX} 张图片`);
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
          addImageView(view);
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
        let imageCount = images.length;
        let attachmentCount = attachments.length;
        for (const view of views) {
          try {
            if (view.kind === 'image') {
              if (imageCount >= INLINE_IMAGE_MAX) {
                setFileError(`最多添加 ${INLINE_IMAGE_MAX} 张图片`);
                releaseChatMedia([view.id]);
                continue;
              }
              addImageView(view);
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
    value.trim().length > 0 || images.length > 0 || attachments.length > 0 || comments.length > 0;

  const sendable = configured && !modelUnavailable && !projectSwitching && canSend;
  const stoppable = busy && (sidechat || !canSend);

  const selectSearchEntry = async (id: string | null) => {
    if (!window.delionBot) return;
    try {
      await capabilitiesClient.selectWebSearchEntry(id);
      void refreshSearch();
    } catch (cause) {
      setFileError(errorMessage(cause));
    }
  };

  const previewed =
    previewing && images.some(([, , id]) => id === previewing.id) ? previewing : null;
  const composer = (
    <div className={cn('relative', previewed && 'mt-13 w-full max-w-138 shrink-0 text-ink')}>
      {queued.length > 0 && (
        <QueuedMessages
          messages={queued.map((text) => stripChatImageTokens(text) || '图片或附件')}
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
        ref={mountPrompt}
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
          void addFiles(files);
        }}
      >
        {(hasMedia || comments.length > 0) && (
          <PromptInputAttachments
            className={cn('-order-2 min-w-0 basis-full p-2', hasMedia && '-mb-1 pb-0')}
          >
            {hasMedia && (
              <div
                aria-label="待发送附件"
                className="flex gap-2 overflow-x-auto p-1 -m-1"
                role="group"
              >
                {images.map(([token, name, id], index) => (
                  <ComposerImage
                    id={id!}
                    key={`${id}-${index}`}
                    name={name || '图片'}
                    onOpen={() => setPreviewing({ id: id!, name: name || '图片' })}
                    onRemove={() => onChange((current) => current.replace(token, ''))}
                  />
                ))}
                {attachments.map((item) => (
                  <div
                    className="group flex h-14 w-48 max-w-full shrink-0 select-none items-center gap-2 rounded-chip border border-line bg-inset px-2"
                    key={item.id}
                    title={item.name}
                  >
                    <span className="grid size-control-sm shrink-0 place-items-center rounded-chip bg-field text-ink-2">
                      <FileIcon path={item.name} className="size-5" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-ui-headline text-ink">{item.name}</div>
                      <div className="text-ui-subhead text-ink-2">
                        {formatBytes(item.size) ?? '0 B'}
                      </div>
                    </div>
                    <IconButton
                      aria-label={`移除附件 ${item.name}`}
                      className={attachmentRemoveVisibility}
                      onClick={() => onRemoveAttachment(item.id)}
                      onMouseDown={(event) => event.preventDefault()}
                      size="xs"
                    >
                      <XMarkIcon />
                    </IconButton>
                  </div>
                ))}
              </div>
            )}
            {comments.length > 0 && (
              <ReplyCommentRail comments={comments} onChange={onCommentsChange} />
            )}
          </PromptInputAttachments>
        )}
        <ComposerEditor
          className={cn(
            'min-w-0',
            expanded
              ? 'basis-full px-2 py-1'
              : 'flex-1 @max-sm:basis-full @max-sm:px-2 @max-sm:py-1',
            hasMedia && 'pt-0',
          )}
          handleRef={editorRef}
          menu={menuApi}
          menuAria={{
            activeId: menuOpen && index < items.length ? menuOptionId(index) : null,
            listId: menuListId,
            open: menuOpen,
          }}
          onChange={(text) =>
            onChange(
              (current) =>
                text +
                matchChatImageTokens(current)
                  .map(([token]) => token)
                  .join(''),
            )
          }
          onCaret={handleCaret}
          onDropHandled={() => setDragging(false)}
          onFiles={(files) => void addFiles(files)}
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
          permissionMode={permissionMode}
        />
        {permissionMode && onPermissionMode && !sidechat && (
          <ChatPermissionPicker
            mode={permissionMode}
            onSelect={onPermissionMode}
            side={hero ? 'bottom' : 'top'}
          />
        )}
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
            <ChatModelPicker
              effort={effort}
              effortLevels={effortLevels}
              expanded={expanded}
              model={model}
              modelUnavailable={modelUnavailable}
              onEffortSelect={onEffortSelect}
              onModelSelect={onModelSelect}
              providerId={providerId}
              side={hero ? 'bottom' : 'top'}
            />
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
                  ) : 'icon' in item ? (
                    <item.icon className="size-4 shrink-0 text-ink-2" />
                  ) : null
                }
                id={menuOptionId(position)}
                key={'name' in item ? item.name : item.key}
                onHover={() => setIndex(position)}
                onSelect={() => handleSelect(position)}
                selected={position === index}
              >
                {'name' in item ? (
                  <span className="flex min-w-0 flex-1 items-baseline gap-1.5 text-ui-body">
                    <span className="shrink-0 text-ink">/{item.name}</span>
                    {'argumentHint' in item && typeof item.argumentHint === 'string' && (
                      <span className="shrink-0 text-ink-2">{item.argumentHint}</span>
                    )}
                    <span className="min-w-0 truncate text-ui-subhead text-ink-2">{item.hint}</span>
                  </span>
                ) : item.session ? (
                  <span className="min-w-0 flex-1 truncate text-ui-body text-ink">
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
      {showAgentActions && agentActions.length > 0 && !previewed && (
        <div
          className={cn(
            'mt-app-gap grid gap-1 pl-1',
            (draft.length > 0 || attachments.length > 0 || comments.length > 0) && 'invisible',
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
  return previewed ? (
    <ImageViewer
      footer={composer}
      images={[{ src: chatMediaUrl(previewed.id), title: previewed.name, mediaId: previewed.id }]}
      index={0}
      onClose={() => setPreviewing(null)}
      onDownload={() => chatClient.saveChatImage({ id: previewed.id, name: previewed.name })}
    />
  ) : (
    composer
  );
}

function MentionTitle({ title }: { title: string }) {
  const at = title.lastIndexOf('/');
  const dir = at < 0 ? '' : title.slice(0, at + 1);
  const name = at < 0 ? title : title.slice(at + 1);
  return (
    <span className="flex min-w-0 flex-1 items-baseline gap-1.5 text-ui-body">
      <span className="shrink-0 text-ink">{name}</span>
      {dir && <span className="min-w-0 truncate text-ui-subhead text-ink-2">{dir}</span>}
    </span>
  );
}
