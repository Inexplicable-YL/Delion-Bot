import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AdjustmentsHorizontalIcon as SlidersHorizontal,
  LockClosedIcon as Lock,
} from '@heroicons/react/24/outline';
import type { AgentCapabilityView } from '../../../../core/protocol/capabilities';
import { Button } from '../../../../ui/Button';
import { Input } from '../../../../ui/Input';
import { Switch } from '../../../../ui/Switch';
import { SectionHeader } from '../SectionHeader';
import { SettingsGroup } from '../SettingsGroup';
import { showToast } from '../../../../ui/Toast';
import { SearchConfigDialog } from './SearchConfigDialog';
import { ErrorText } from '../../../../ui/Alert';
import { Spinner } from '../../../../ui/Spinner';
import { capabilitiesClient, onWebSearchChanged } from '../../../chat/view';
import { errorMessage } from '../../../../core/protocol/contract';

function groupByDomain(capabilities: AgentCapabilityView[]) {
  const groups = new Map<string, { id: string; label: string; items: AgentCapabilityView[] }>();
  for (const capability of capabilities) {
    const group = groups.get(capability.domain);
    if (group) group.items.push(capability);
    else
      groups.set(capability.domain, {
        id: capability.domain,
        label: capability.domainLabel,
        items: [capability],
      });
  }
  return [...groups.values()];
}

function SubagentLimit() {
  const queryClient = useQueryClient();
  const saved = useQuery({
    queryKey: ['capabilities', 'subagentLimit'],
    queryFn: () => capabilitiesClient.subagentLimit(),
  }).data;
  const [edited, setEdited] = useState<string | null>(null);
  if (saved === undefined) return null;
  const draft = edited ?? String(saved);
  const save = async () => {
    const limit = Number(draft);
    if (limit === saved) return;
    try {
      queryClient.setQueryData(
        ['capabilities', 'subagentLimit'],
        await capabilitiesClient.setSubagentLimit(limit),
      );
    } catch {
      showToast({ variant: 'error', title: '保存失败', description: '上限须为 1 到 16 的整数' });
    }
    setEdited(null);
  };
  return (
    <div
      className="flex items-center justify-between gap-4 border-b py-3 last:border-0"
      data-setting-id="capability-subagent-limit"
    >
      <div className="grid min-w-0 gap-0.5">
        <span className="truncate text-ui-headline">同时运行上限</span>
        <span className="line-clamp-2 text-ui-subhead text-ink-2">
          全应用同时运行的子 Agent 数，超出时派发失败，不排队
        </span>
      </div>
      <Input
        aria-label="子 Agent 同时运行上限"
        className="w-16 shrink-0"
        max="16"
        min="1"
        step="1"
        type="number"
        value={draft}
        onBlur={() => void save()}
        onChange={(event) => setEdited(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur();
        }}
      />
    </div>
  );
}

export function CapabilitiesSection() {
  const queryClient = useQueryClient();
  const list = useQuery({
    queryKey: ['capabilities', 'builtin'],
    queryFn: () => capabilitiesClient.listBuiltinCapabilities(),
    enabled: Boolean(window.delionBot),
  });
  const capabilities = list.data;
  const [busy, setBusy] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);

  const watchCapabilities = (element: HTMLDivElement | null) => {
    if (!element) return;
    return onWebSearchChanged(
      () => void queryClient.invalidateQueries({ queryKey: ['capabilities', 'builtin'] }),
    );
  };

  const run = async (operation: () => Promise<AgentCapabilityView[]>) => {
    if (!window.delionBot || busy) return;
    setBusy(true);
    try {
      queryClient.setQueryData(['capabilities', 'builtin'], await operation());
    } catch (cause) {
      showToast({ variant: 'error', title: '保存失败', description: errorMessage(cause) });
    }
    setBusy(false);
  };

  return (
    <div className="grid gap-10" data-setting-id="capabilities" ref={watchCapabilities}>
      <SectionHeader title="内置能力" />
      {!window.delionBot ? (
        <p className="text-ui-body text-ink-2">内置能力配置仅在桌面端可用。</p>
      ) : (
        <>
          {capabilities === undefined && !list.error ? (
            <SettingsGroup>
              <p
                className="flex items-center gap-2 py-3.5 text-ui-subhead text-ink-2"
                role="status"
              >
                <Spinner />
                正在读取能力清单…
              </p>
            </SettingsGroup>
          ) : null}
          {capabilities && (
            <div className="grid gap-10">
              {groupByDomain(capabilities).map((group) => {
                const toggleable = group.items.filter((item) => !item.lockedReason);
                const enabledCount = toggleable.filter((item) => item.enabled).length;
                const allEnabled = enabledCount === toggleable.length && toggleable.length > 0;
                const lockedReason = group.items.find((item) => item.lockedReason)?.lockedReason;
                return (
                  <SettingsGroup
                    action={
                      <div className="flex items-center gap-1">
                        {group.id === 'web' && (
                          <Button
                            aria-label="配置搜索服务"
                            title="配置搜索服务"
                            variant="ghost"
                            size="icon-sm"
                            onClick={() => setSearchOpen(true)}
                          >
                            <SlidersHorizontal className="size-4" />
                          </Button>
                        )}
                        {toggleable.length > 1 && (
                          <Switch
                            checked={allEnabled}
                            disabled={busy}
                            indeterminate={!allEnabled && enabledCount > 0}
                            label={`${group.label}：${allEnabled ? '全部关闭' : '全部开启'}`}
                            onChange={(next) =>
                              void run(() =>
                                capabilitiesClient.setBuiltinDomain({
                                  domain: group.id,
                                  enabled: next,
                                }),
                              )
                            }
                          />
                        )}
                      </div>
                    }
                    description={
                      lockedReason ? (
                        <span className="flex items-center gap-1.5">
                          <Lock aria-hidden="true" className="size-4 shrink-0" />
                          常驻能力 · {lockedReason}
                        </span>
                      ) : undefined
                    }
                    key={group.id}
                    settingId={`capabilities-${group.id}`}
                    title={group.label}
                  >
                    {group.items.map((capability) => (
                      <div
                        className="flex items-start justify-between gap-4 border-b py-3 last:border-0"
                        data-setting-id={`capability-${capability.name}`}
                        key={capability.name}
                      >
                        <div className="grid min-w-0 gap-0.5">
                          <div className="flex min-w-0 items-baseline gap-2">
                            <span className="truncate text-ui-headline">{capability.label}</span>
                            <span className="truncate font-mono text-ui-subhead text-ink-2">
                              {capability.name}
                            </span>
                          </div>
                          <span className="line-clamp-2 text-ui-subhead text-ink-2">
                            {capability.description}
                          </span>
                        </div>
                        {capability.lockedReason ? (
                          <span className="flex shrink-0 items-center gap-1 rounded-full bg-fill px-2 py-1 text-ui-subhead text-ink-2">
                            <Lock aria-hidden="true" className="size-4" />
                            常驻
                          </span>
                        ) : (
                          <Switch
                            checked={capability.enabled}
                            disabled={busy}
                            label={capability.label}
                            onChange={(next) =>
                              void run(() =>
                                capabilitiesClient.setBuiltinCapability({
                                  name: capability.name,
                                  enabled: next,
                                }),
                              )
                            }
                          />
                        )}
                      </div>
                    ))}
                    {group.id === 'subagent' &&
                      group.items.some((item) => item.name === 'task' && item.enabled) && (
                        <SubagentLimit />
                      )}
                  </SettingsGroup>
                );
              })}
            </div>
          )}
          {list.error && <ErrorText>{errorMessage(list.error)}</ErrorText>}
          {searchOpen && <SearchConfigDialog onClose={() => setSearchOpen(false)} />}
        </>
      )}
    </div>
  );
}
