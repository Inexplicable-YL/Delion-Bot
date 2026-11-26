import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowPathIcon as RefreshCw,
  PencilIcon as Pencil,
  PlusIcon as Plus,
  TrashIcon as Trash2,
} from '@heroicons/react/24/outline';
import type { McpServerView } from '../../../../core/protocol/capabilities';
import { Button } from '../../../../ui/Button';
import { CollapsibleSection } from '../../../../ui/Collapse';
import { Switch } from '../../../../ui/Switch';
import { cn } from '../../../../ui/cn';
import { showToast } from '../../../../ui/Toast';
import { SettingsGroup } from '../SettingsGroup';
import { mcpStatusBadge } from './mcp-logic';
import { McpFormDialog, type McpEditState } from './McpFormDialog';
import { ConfirmDialog } from '../../../../ui/Dialog';
import { ErrorText } from '../../../../ui/Alert';
import { Spinner } from '../../../../ui/Spinner';
import { capabilitiesClient } from '../../../chat/view';
import { errorMessage } from '../../../../core/protocol/contract';

export function McpTab() {
  const queryClient = useQueryClient();
  const list = useQuery({
    queryKey: ['capabilities', 'mcpServers'],
    queryFn: () => capabilitiesClient.listMcpServers(),
    enabled: Boolean(window.delionBot),
    refetchInterval: (query) =>
      query.state.data?.some((view) => view.status === 'connecting') ? 500 : false,
  });
  const servers = list.data;
  const empty = servers?.length === 0;
  const [expanded, setExpanded] = useState<boolean | null>(null);
  const open = expanded ?? empty;
  const setServers = (views: McpServerView[] | undefined) =>
    queryClient.setQueryData(['capabilities', 'mcpServers'], views);
  const [busy, setBusy] = useState(false);
  const [dialog, setDialog] = useState<McpEditState>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);

  const toggle = async (server: McpServerView, next: boolean) => {
    if (!window.delionBot || busy) return;
    setBusy(true);
    const previous = servers;
    setServers(
      (previous ?? []).map((view) => (view.id === server.id ? { ...view, enabled: next } : view)),
    );
    try {
      setServers(
        await capabilitiesClient.updateMcpServer({ id: server.id, patch: { enabled: next } }),
      );
    } catch (cause) {
      setServers(previous);
      showToast({ variant: 'error', title: '保存失败', description: errorMessage(cause) });
    }
    setBusy(false);
  };

  const reconnect = async (id: string) => {
    if (!window.delionBot || busy) return;
    setBusy(true);
    try {
      setServers(await capabilitiesClient.refreshMcpServer(id));
    } catch (cause) {
      showToast({ variant: 'error', title: '重连失败', description: errorMessage(cause) });
    }
    setBusy(false);
  };

  const remove = async (id: string) => {
    if (!window.delionBot || busy) return;
    setBusy(true);
    try {
      setServers(await capabilitiesClient.removeMcpServer(id));
      setConfirmId(null);
    } catch (cause) {
      setConfirmId(null);
      showToast({ variant: 'error', title: '删除失败', description: errorMessage(cause) });
    }
    setBusy(false);
  };

  return (
    <CollapsibleSection onOpenChange={setExpanded} open={open} title="自定义连接器">
      <div className="grid gap-6 pt-6">
        {window.delionBot ? (
          <Button
            className={empty ? 'justify-self-center' : 'justify-self-end'}
            onClick={() => {
              setExpanded(true);
              setDialog({ mode: 'create' });
            }}
            size="sm"
            variant="secondary"
          >
            <Plus />
            添加自定义连接器
          </Button>
        ) : (
          <p className="text-ui-body text-ink-2">MCP 管理仅在桌面端可用。</p>
        )}
        {servers && servers.length > 0 && (
          <SettingsGroup>
            <ul className="grid">
              {servers.map((server) => {
                const badge = mcpStatusBadge(server.status, server.toolCount);
                return (
                  <li
                    className="flex items-center justify-between gap-4 border-b py-3 last:border-0"
                    key={server.id}
                  >
                    <div className="grid min-w-0 gap-1">
                      <div className="flex min-w-0 flex-wrap items-center gap-2">
                        <strong className="truncate text-ui-body">{server.name}</strong>
                        <span
                          className="inline-flex items-center gap-1.5 text-ui-subhead text-ink-2"
                          title={server.error ?? undefined}
                        >
                          {badge.spin ? (
                            <Spinner className={badge.dotClass} size="xs" />
                          ) : (
                            <span className={cn('size-2 shrink-0 rounded-full', badge.dotClass)} />
                          )}
                          {badge.label}
                        </span>
                      </div>
                      {server.status === 'error' && server.error ? (
                        <p className="truncate text-ui-subhead text-danger" title={server.error}>
                          {server.error}
                        </p>
                      ) : null}
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <Switch
                        checked={server.enabled}
                        disabled={busy}
                        label={`启用 ${server.name}`}
                        onChange={(next) => void toggle(server, next)}
                      />
                      <Button
                        aria-label={`重连 ${server.name}`}
                        disabled={busy || !server.enabled}
                        onClick={() => void reconnect(server.id)}
                        size="icon-sm"
                        variant="ghost"
                      >
                        <RefreshCw />
                      </Button>
                      <Button
                        aria-label={`编辑 ${server.name}`}
                        disabled={busy}
                        onClick={() => setDialog({ mode: 'edit', server })}
                        size="icon-sm"
                        variant="ghost"
                      >
                        <Pencil />
                      </Button>
                      <Button
                        aria-label={`删除 ${server.name}`}
                        disabled={busy}
                        onClick={() => setConfirmId(server.id)}
                        size="icon-sm"
                        variant="ghost"
                      >
                        <Trash2 />
                      </Button>
                    </div>
                    <ConfirmDialog
                      confirmLabel={busy ? '删除中…' : '删除'}
                      description="将移除该服务器配置并断开连接，Agent 不再能使用它的工具。此操作不可撤销。"
                      destructive
                      busy={busy}
                      onConfirm={() => void remove(server.id)}
                      onOpenChange={(open) => !open && !busy && setConfirmId(null)}
                      open={confirmId === server.id}
                      title={`删除 ${server.name}？`}
                    />
                  </li>
                );
              })}
            </ul>
          </SettingsGroup>
        )}
        {list.error && <ErrorText>{errorMessage(list.error)}</ErrorText>}
        {dialog && (
          <McpFormDialog editing={dialog} onClose={() => setDialog(null)} onSaved={setServers} />
        )}
      </div>
    </CollapsibleSection>
  );
}
