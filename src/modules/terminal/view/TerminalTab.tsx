import { useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import {
  ClipboardIcon as ClipboardPaste,
  CommandLineIcon as SquareTerminal,
  DocumentDuplicateIcon as Copy,
  PlusIcon as Plus,
  XMarkIcon as X,
} from '@heroicons/react/24/outline';
import { onTerminalEvent, terminalClient } from './client';
import { useTerminalStore } from './store';
import { showToast } from '../../../ui/Toast';
import { Button } from '../../../ui/Button';
import { cn } from '../../../ui/cn';
import '@xterm/xterm/css/xterm.css';
import { ErrorText } from '../../../ui/Alert';
import { errorMessage } from '../../../core/protocol/contract';

function terminalColor(value: string): string {
  const context = document.createElement('canvas').getContext('2d')!;
  context.fillStyle = value;
  context.fillRect(0, 0, 1, 1);
  const [r, g, b] = context.getImageData(0, 0, 1, 1).data;
  return `rgb(${r}, ${g}, ${b})`;
}

function withAlpha(color: string, alpha: number): string {
  return color.replace('rgb(', 'rgba(').replace(')', `, ${alpha})`);
}

const noTabs: never[] = [];

export function TerminalTab({ tabId }: { tabId: string }) {
  const desktop = Boolean(window.delionBot);
  const projectId = tabId.slice('terminal:'.length);
  const tabs = useTerminalStore((state) => state.tabs[projectId]) ?? noTabs;
  const remembered = useTerminalStore((state) => state.active[projectId]);
  const select = useTerminalStore((state) => state.select);
  const [creating, setCreating] = useState(false);
  const [reported, setReported] = useState<string | null>(null);
  const [hasSelection, setHasSelection] = useState(false);
  const screen = useRef<Terminal | null>(null);

  const active = tabs.find((item) => item.id === remembered) ?? tabs[0];
  const activeId = active?.id ?? null;

  const create = async () => {
    if (!desktop) return;
    setCreating(true);
    setReported(null);
    try {
      await useTerminalStore.getState().create(projectId);
    } catch (cause) {
      showToast({ variant: 'error', title: '新建终端失败', description: errorMessage(cause) });
    }
    setCreating(false);
  };

  const opened = useQuery({
    queryKey: ['terminal', 'open', projectId],
    queryFn: async () => {
      const items = await useTerminalStore.getState().load(projectId);
      if (!items.length) await create();
      return null;
    },
    enabled: desktop,
    gcTime: 0,
    staleTime: Infinity,
  });
  const busy = desktop && (opened.isPending || creating);
  const error = desktop
    ? (reported ?? (opened.error ? errorMessage(opened.error) : null))
    : '内置终端仅在桌面应用中可用';

  const copy = async () => {
    const text = screen.current?.getSelection();
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
    } catch (cause) {
      showToast({ variant: 'error', title: '复制失败', description: errorMessage(cause) });
    }
  };
  const paste = async () => {
    const current = screen.current;
    if (!current || current.options.disableStdin) return;
    try {
      const text = await navigator.clipboard.readText();
      if (screen.current !== current) return;
      current.paste(text);
      current.focus();
    } catch (cause) {
      showToast({ variant: 'error', title: '粘贴失败', description: errorMessage(cause) });
    }
  };

  const attachTerminal = (element: HTMLDivElement | null) => {
    if (!element) return;
    const session = useTerminalStore.getState().output[activeId ?? ''];
    if (!activeId || !session) return;
    const style = getComputedStyle(element);
    const foreground = terminalColor(style.color);
    const terminal = new Terminal({
      allowTransparency: true,
      fontFamily: style.fontFamily,
      fontSize: parseFloat(style.fontSize),
      theme: {
        background: withAlpha(foreground, 0),
        foreground,
        cursor: foreground,
        cursorAccent: terminalColor(style.getPropertyValue('--page')),
        selectionBackground: withAlpha(foreground, 0.28),
        selectionInactiveBackground: withAlpha(foreground, 0.16),
      },
      minimumContrastRatio: 4.5,
      disableStdin: active?.exitCode !== null,
      altClickMovesCursor: true,
      cursorStyle: 'block',
      cursorBlink: true,
      allowProposedApi: false,
    });
    const fit = new FitAddon();
    terminal.loadAddon(fit);
    terminal.open(element);
    let replaying = true;
    terminal.write(session.buffer, () => {
      replaying = false;
    });
    screen.current = terminal;
    const selection = terminal.onSelectionChange(() => setHasSelection(terminal.hasSelection()));
    terminal.attachCustomKeyEventHandler((event) => {
      const clipboardModifier =
        window.delionBot?.platform === 'darwin'
          ? event.metaKey && !event.ctrlKey && !event.shiftKey
          : event.ctrlKey && !event.metaKey && event.shiftKey;
      if (event.type === 'keydown' && clipboardModifier && !event.altKey) {
        if (event.code === 'KeyC' || event.code === 'KeyV') {
          event.preventDefault();
          if (event.code === 'KeyC') void copy();
          else void paste();
          return false;
        }
      }
      return true;
    });
    const reportError = (cause: unknown) => setReported(errorMessage(cause));
    const resize = () => {
      if (!element.clientWidth || !element.clientHeight) return;
      fit.fit();
      void terminalClient
        .resize({ id: activeId, cols: terminal.cols, rows: terminal.rows })
        .catch(reportError);
    };
    const input = terminal.onData((data) => {
      if (replaying) return;
      void terminalClient.write({ id: activeId, data }).catch(reportError);
    });
    let lastSequence = session.sequence;
    const stopEvents = onTerminalEvent('event', (event) => {
      if (event.id !== activeId || event.sequence <= lastSequence) return;
      lastSequence = event.sequence;
      if (event.type === 'data') terminal.write(event.data);
      else terminal.options.disableStdin = true;
    });
    const observer = new ResizeObserver(resize);
    observer.observe(element);
    const themeObserver = new MutationObserver(() => {
      const style = getComputedStyle(element);
      const foreground = terminalColor(style.color);
      terminal.options.theme = {
        background: withAlpha(foreground, 0),
        foreground,
        cursor: foreground,
        cursorAccent: terminalColor(style.getPropertyValue('--page')),
        selectionBackground: withAlpha(foreground, 0.28),
        selectionInactiveBackground: withAlpha(foreground, 0.16),
      };
      terminal.options.fontSize = parseFloat(style.fontSize);
      resize();
    });
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class', 'style'],
    });
    resize();
    terminal.focus();
    return () => {
      stopEvents();
      observer.disconnect();
      themeObserver.disconnect();
      input.dispose();
      selection.dispose();
      screen.current = null;
      setHasSelection(false);
      terminal.dispose();
    };
  };
  const close = async (id: string) => {
    try {
      await useTerminalStore.getState().close(projectId, id);
    } catch (cause) {
      showToast({ variant: 'error', title: '关闭终端失败', description: errorMessage(cause) });
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center gap-1 border-b px-2 py-1">
        <div
          aria-label="终端会话"
          className="flex min-w-0 flex-1 gap-1 overflow-x-auto"
          role="tablist"
        >
          {tabs.map((session, index) => (
            <div
              key={session.id}
              className={cn(
                'flex shrink-0 items-center rounded-control text-ui-body text-ink-2',
                session.id === activeId && 'bg-hover text-ink',
              )}
            >
              <button
                aria-selected={session.id === activeId}
                className="flex items-center gap-2 rounded-control px-3 py-1.5 focus-visible:outline focus-visible:outline-accent"
                role="tab"
                type="button"
                onClick={() => select(projectId, session.id)}
              >
                <SquareTerminal className="size-4" />
                {session.title} {index + 1}
                {session.exitCode !== null && (
                  <span className="text-ui-subhead text-ink-2">已结束</span>
                )}
              </button>
              <Button
                aria-label={`关闭终端 ${index + 1}`}
                title="关闭终端"
                variant="ghost"
                size="icon-xs"
                onClick={() => void close(session.id)}
              >
                <X />
              </Button>
            </div>
          ))}
        </div>
        <Button
          aria-label="复制终端选区"
          title={
            window.delionBot?.platform === 'darwin' ? '复制选区（⌘C）' : '复制选区（Ctrl+Shift+C）'
          }
          disabled={!hasSelection}
          variant="ghost"
          size="icon-sm"
          onClick={() => void copy()}
        >
          <Copy />
        </Button>
        <Button
          aria-label="粘贴到终端"
          title={window.delionBot?.platform === 'darwin' ? '粘贴（⌘V）' : '粘贴（Ctrl+Shift+V）'}
          disabled={!active || active.exitCode !== null}
          variant="ghost"
          size="icon-sm"
          onClick={() => void paste()}
        >
          <ClipboardPaste />
        </Button>
        <Button
          aria-label="新建终端"
          title="新建终端"
          disabled={busy}
          variant="ghost"
          size="icon-sm"
          onClick={() => void create()}
        >
          <Plus />
        </Button>
      </div>
      {error && (
        <ErrorText size="sm" className="shrink-0 px-3 py-2">
          {error}
        </ErrorText>
      )}
      {active?.exitCode !== null && active && (
        <p className="shrink-0 px-3 py-1 text-ui-subhead text-ink-2">
          进程已结束，退出码 {active.exitCode}。可新建终端继续操作。
        </p>
      )}
      {!activeId && (
        <div className="flex flex-1 items-center justify-center text-ui-body text-ink-2">
          {busy ? '正在打开终端…' : '点击 + 新建终端'}
        </div>
      )}
      <div
        key={activeId}
        ref={attachTerminal}
        title="拖动选取文本；Alt+单击移动输入光标；右键复制选区或粘贴"
        onContextMenu={(event) => {
          event.preventDefault();
          event.stopPropagation();
          if (screen.current?.hasSelection()) void copy();
          else void paste();
        }}
        className={cn(
          'min-h-0 flex-1 overflow-hidden p-2 font-mono text-ui-body text-ink',
          !activeId && 'hidden',
        )}
      />
    </div>
  );
}
