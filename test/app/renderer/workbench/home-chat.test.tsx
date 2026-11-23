// @vitest-environment jsdom
import { act } from 'react';
import { notifyManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorkspaceChat } from '../../../../src/core/protocol/agent';
import type { LocalCommandReply } from '../../../../src/modules/chat/contract';
import { useSidechats } from '../../../../src/modules/chat/view/sidechat-store';

const { api, delion } = vi.hoisted(() => {
  const api: Record<string, (input: never) => unknown> = {};
  const delion = {
    bridge: {
      invoke: async (channel: string, input: never) => api[channel]!(input),
      subscribe: () => () => {},
    },
  } as unknown as NonNullable<typeof window.delionBot>;
  window.delionBot = delion;
  return { api, delion };
});
import { useNavigationStore } from '../../../../src/app/renderer/navigation/view';
import { useWorkbenchLayout } from '../../../../src/app/renderer/workbench/layout-store';
import { walkGroups } from '../../../../src/app/renderer/workbench/layout-schema';
import { useWorkspaceStore } from '../../../../src/modules/workspace/view';
import {
  ChatHome,
  ChatTab,
  ChatTabSourceProvider,
  useChatDrafts,
  useSessions,
} from '../../../../src/modules/chat/view';

vi.mock('../../../../src/modules/chat/view/ChatComposer', () => ({
  ChatComposer: ({
    value,
    onChange,
    onSend,
    onSelectProject,
    projectSwitching,
    notice,
  }: {
    value: string;
    onChange: (value: string) => void;
    onSend: () => void;
    onSelectProject?: (projectId: string | null) => void;
    projectSwitching?: boolean;
    notice?: string | null;
  }) => (
    <>
      <input
        aria-label="消息输入"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
      <button disabled={projectSwitching} onClick={onSend}>
        发送
      </button>
      {onSelectProject && <button onClick={() => onSelectProject('project')}>选择项目</button>}
      {notice && <p role="alert">{notice}</p>}
    </>
  ),
}));
vi.mock('../../../../src/modules/chat/view/ChatThread', () => ({
  ChatThread: ({
    chat,
    commandReplies = [],
  }: {
    chat: WorkspaceChat;
    commandReplies?: LocalCommandReply[];
  }) => (
    <div aria-label="对话消息">
      {[
        ...chat.messages.map((message) => message.content),
        ...commandReplies.flatMap(({ input, reply }) => [input, reply]),
      ].join('\n')}
    </div>
  ),
}));

notifyManager.setScheduler(queueMicrotask);

let host: HTMLDivElement;
let root: Root;
let queryClient: QueryClient;

const noChatTab = () =>
  !walkGroups(useWorkbenchLayout.getState().root).some((group) =>
    group.tabs.some((tab) => tab.startsWith('chat:')),
  );

function Home() {
  const request = useNavigationStore((state) => state.generalChat);
  const source = {
    navigate: useNavigationStore.getState().navigate,
    workbench: { open: () => {}, openDocument: () => {}, close: () => {} },
    opensLink: () => false,
  };
  return (
    <QueryClientProvider client={queryClient}>
      <ChatTabSourceProvider source={source}>
        <ChatHome request={request} />
      </ChatTabSourceProvider>
    </QueryClientProvider>
  );
}

function emptyChat(sessionId: string): WorkspaceChat {
  return {
    sessionId,
    projectId: null,
    cwd: null,
    configured: true,
    providerId: null,
    providerName: null,
    model: 'test',
    modelUnavailable: false,
    effortLevels: [],
    effort: null,
    messages: [],
  };
}

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  useNavigationStore.setState({
    view: 'home',
    projectId: null,
    generalChat: null,
    backStack: [],
    forwardStack: [],
  });
  useWorkbenchLayout.setState({ pendingReveal: null });
  useSessions.setState({ chats: {}, lists: {}, homeSessionId: null });
  useWorkspaceStore.setState({ workspace: { directory: '', entries: [] } });
  useChatDrafts.setState({ drafts: {} });
  useSidechats.setState({ views: {}, collapsed: {}, entered: {} });
  for (const channel of Object.keys(api)) delete api[channel];
  Object.assign(api, {
    'agent:create-session': async () => emptyChat('first'),
    'agent:list-sessions': async () => [],
    'chat:projectContext': async () => ({ instruction: '', files: [] }),
    'chat:localCommandReplies': async () => [],
    'agent:open-session': async ({ sessionId }: { sessionId: string }) =>
      useSessions.getState().chats[sessionId]!,
    'agent:ask': async ({ sessionId, text }: { sessionId: string; text: string }) => ({
      ...emptyChat(sessionId),
      messages: [
        { role: 'user' as const, content: text },
        { role: 'assistant' as const, content: '回答' },
      ],
    }),
  });
  window.delionBot = delion;
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});

it('/btw 打开旁问后直接发送问题正文', async () => {
  const side = { parentId: 'first', running: false, messages: [] };
  api['agent:open-sidechat'] = vi.fn(async () => side);
  api['agent:ask-sidechat'] = vi.fn(async () => side);
  const ask = vi.spyOn(api, 'agent:ask');
  await act(async () => root.render(<Home />));
  await act(async () => useChatDrafts.getState().update('first', { prompt: '/btw 隔壁的问题' }));
  await act(async () => {
    [...host.querySelectorAll('button')].find((button) => button.textContent === '发送')!.click();
  });
  expect(api['agent:open-sidechat']).toHaveBeenCalledWith({ parentId: 'first' });
  expect(api['agent:ask-sidechat']).toHaveBeenCalledWith({
    parentId: 'first',
    text: '隔壁的问题',
    attachments: [],
    context: [],
    sessions: [],
    comments: [],
  });
  expect(ask).not.toHaveBeenCalled();
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.useRealTimers();
  delete window.delionBot;
  vi.unstubAllGlobals();
});

it('随聊发送首条消息后保持首页聊天，继续显示同一会话的回复', async () => {
  await act(async () => root.render(<Home />));
  await act(async () => useChatDrafts.getState().update('first', { prompt: '测试随聊' }));
  await act(async () =>
    host.querySelectorAll('button').forEach((button) => {
      if (button.textContent === '发送') button.click();
    }),
  );
  expect(host.querySelector('[aria-label="对话消息"]')?.textContent).toBe('测试随聊\n回答');
  expect(useNavigationStore.getState().view).toBe('home');
  expect(useWorkbenchLayout.getState().pendingReveal).toBeNull();
  expect(noChatTab()).toBe(true);
});

it('首页新对话切换归属后在原处显示项目名并发送同一份草稿', async () => {
  const cwd = 'D:/workspace/project';
  const moved = { ...emptyChat('first'), projectId: 'project', cwd };
  useWorkspaceStore.setState({
    workspace: {
      directory: 'D:/workspace',
      entries: [
        {
          id: 'project',
          kind: 'project',
          name: '测试项目',
          parentId: null,
          sourceId: null,
          updatedAt: '',
          path: cwd,
        },
      ],
    },
  });
  let finishMove!: () => void;
  api['chat:move'] = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        finishMove = resolve;
      }),
  );
  api['agent:open-session'] = async () => moved;
  const ask = vi.fn(async ({ text }: { text: string }): Promise<WorkspaceChat> => ({
    ...moved,
    messages: [{ role: 'user', content: text }],
  }));
  api['agent:ask'] = ask;
  const button = (text: string) =>
    [...host.querySelectorAll('button')].find((node) => node.textContent === text)!;
  await act(async () => root.render(<Home />));
  await act(async () => useChatDrafts.getState().update('first', { prompt: '已有草稿' }));
  await act(async () => button('选择项目').click());
  expect(api['chat:move']).toHaveBeenCalledWith({ id: 'first', projectId: 'project' });
  expect(button('发送').disabled).toBe(true);
  await act(async () => finishMove());
  expect(host.querySelector('h1')?.textContent).toBe('测试项目');
  expect(host.querySelector<HTMLInputElement>('input[aria-label="消息输入"]')?.value).toBe(
    '已有草稿',
  );
  expect(useSessions.getState().chats.first?.cwd).toBe(cwd);
  await act(async () => button('发送').click());
  expect(ask).toHaveBeenCalledWith(
    expect.objectContaining({ sessionId: 'first', text: '已有草稿' }),
  );
  expect(useNavigationStore.getState().view).toBe('home');
  expect(useSessions.getState().homeSessionId).toBe('first');
  expect(noChatTab()).toBe(true);
});

it('项目新会话始终显示项目面板，近期只打开当前项目的历史会话', async () => {
  const projectId = 'project';
  const cwd = 'D:/workspace/project';
  useWorkspaceStore.setState({
    workspace: {
      directory: 'D:/workspace',
      entries: [
        {
          id: projectId,
          kind: 'project',
          name: '测试项目',
          parentId: null,
          sourceId: null,
          updatedAt: '',
          path: cwd,
        },
      ],
    },
  });
  useSessions.getState().putChat('new', { ...emptyChat('new'), projectId, cwd });
  const source = {
    navigate: useNavigationStore.getState().navigate,
    workbench: { open: () => {}, openDocument: () => {}, close: () => {} },
    opensLink: () => false,
  };
  await act(async () =>
    root.render(
      <QueryClientProvider client={queryClient}>
        <ChatTabSourceProvider source={source}>
          <ChatTab tabId="chat:new" groupId="group" />
        </ChatTabSourceProvider>
      </QueryClientProvider>,
    ),
  );
  const panel = host.querySelector('[aria-label="项目设置面板"]')!;
  const tabs = () => [...panel.querySelectorAll('button')].map((button) => button.textContent);
  expect(tabs()).toEqual(['建议', '说明', '文件']);

  const summary = (id: string, title: string, updatedAt: string, pool: string | null) => ({
    id,
    title,
    updatedAt,
    projectId: pool,
    createdAt: updatedAt,
    pinned: false,
  });
  await act(async () =>
    useSessions.setState({
      lists: {
        [projectId]: [
          summary('older', '较早会话', '2026-11-20T12:00:00Z', projectId),
          summary('latest', '最近会话', '2026-11-21T12:00:00Z', projectId),
        ],
        general: [summary('general', '通用会话', '2026-11-21T13:00:00Z', null)],
      },
    }),
  );
  expect(tabs()).toEqual(['建议', '近期', '说明', '文件']);
  await act(async () => panel.querySelectorAll('button')[1]!.click());
  const rows = [...host.querySelectorAll<HTMLButtonElement>('[aria-label="近期会话"] button')];
  expect(rows.map((row) => row.title)).toEqual(['最近会话', '较早会话']);
  await act(async () => rows[0]!.click());
  expect(useNavigationStore.getState().projectId).toBe(projectId);
  expect(useWorkbenchLayout.getState().pendingReveal?.tabId).toBe('chat:latest');
});

it('回到首页接着上次会话，清空运行内存（重启）后才是新对话', async () => {
  await act(async () => root.render(<Home />));
  await act(async () =>
    useSessions.getState().putChat('first', {
      ...emptyChat('first'),
      messages: [{ role: 'assistant' as const, content: '上次的回复' }],
    }),
  );
  const create = vi.spyOn(api, 'agent:create-session');
  await act(async () => useNavigationStore.getState().openGeneralChat(false));
  expect(host.querySelector('[aria-label="对话消息"]')?.textContent).toBe('上次的回复');
  expect(create).not.toHaveBeenCalled();
  await act(async () => useSessions.setState({ homeSessionId: null }));
  await act(async () => useNavigationStore.getState().openGeneralChat(false));
  expect(create).toHaveBeenCalledTimes(1);
  expect(create).toHaveBeenCalledWith({ projectId: null });
});

it('历史快速切换时延迟返回不能覆盖最新会话，项目历史仍进入项目工作台', async () => {
  await act(async () => root.render(<Home />));
  let resolveOld!: (chat: WorkspaceChat) => void;
  const latest = {
    ...emptyChat('latest'),
    messages: [{ role: 'assistant' as const, content: '最新选中的历史' }],
  };
  useSessions.getState().putChat('latest', latest);
  api['agent:open-session'] = ({ sessionId }: { sessionId: string }) =>
    sessionId === 'slow'
      ? new Promise((resolve) => {
          resolveOld = resolve;
        })
      : Promise.resolve(latest);
  await act(async () => useNavigationStore.getState().openChat('slow', null));
  expect(host.querySelector('[aria-label="消息输入"]')).toBeNull();
  await act(async () => useNavigationStore.getState().openChat('latest', null));
  await act(async () =>
    resolveOld({
      ...emptyChat('slow'),
      messages: [{ role: 'assistant', content: '较早选中的历史' }],
    }),
  );
  expect(host.textContent).toContain('最新选中的历史');
  expect(host.textContent).not.toContain('较早选中的历史');
  expect(useNavigationStore.getState().view).toBe('home');
  await act(async () => useNavigationStore.getState().openChat('project-history', 'project'));
  expect(useNavigationStore.getState().view).toBe('workbench');
  expect(useNavigationStore.getState().projectId).toBe('project');
  expect(useWorkbenchLayout.getState().pendingReveal?.tabId).toBe('chat:project-history');
});

describe('会话命令', () => {
  const sendText = async (text: string) => {
    await act(async () => useChatDrafts.getState().update('first', { prompt: text }));
    await act(async () =>
      host.querySelectorAll('button').forEach((button) => {
        if (button.textContent === '发送') button.click();
      }),
    );
  };

  it('/name 走命令通道、不发给模型，改完重读会话列表让标题生效', async () => {
    const runCommand = vi.fn(async () => [
      { input: '/name 课程周报', reply: '已将对话重命名为「课程周报」。', sentAt: 1, repliedAt: 2 },
    ]);
    api['chat:runLocalCommand'] = runCommand;
    const ask = vi.spyOn(api, 'agent:ask');
    await act(async () => root.render(<Home />));
    const list = vi.spyOn(api, 'agent:list-sessions');
    await sendText('  /name  课程周报  ');
    expect(runCommand).toHaveBeenCalledWith({
      sessionId: 'first',
      name: 'name',
      args: '课程周报',
    });
    expect(ask).not.toHaveBeenCalled();
    expect(list).toHaveBeenCalledWith({ projectId: null });
    expect(useChatDrafts.getState().drafts.first?.prompt ?? '').toBe('');
    expect(host.querySelector('[aria-label="对话消息"]')?.textContent).toContain(
      '已将对话重命名为「课程周报」。',
    );
  });

  it('命令失败时将原因作为回复显示', async () => {
    api['chat:runLocalCommand'] = vi.fn(async () => [
      {
        input: '/compact 保留结论',
        reply: '对话还太短，没有可压缩的内容',
        sentAt: 1,
        repliedAt: 2,
      },
    ]);
    await act(async () => root.render(<Home />));
    await sendText('/compact 保留结论');
    expect(host.querySelector('[aria-label="对话消息"]')?.textContent).toContain(
      '对话还太短，没有可压缩的内容',
    );
  });

  it('只是以 / 开头、不是命令的文字照常发给模型', async () => {
    const runCommand = vi.fn();
    api['chat:runLocalCommand'] = runCommand;
    const ask = vi.spyOn(api, 'agent:ask');
    await act(async () => root.render(<Home />));
    await sendText('/compactor 是什么');
    expect(ask).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: 'first', text: '/compactor 是什么' }),
    );
    expect(runCommand).not.toHaveBeenCalled();
  });
});
