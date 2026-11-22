import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronDownIcon, ChevronRightIcon } from '@heroicons/react/24/outline';
import type { LlmProviderView } from '../../../core/protocol/llm';
import {
  PromptInputOption,
  PromptInputOptionCheck,
  PromptInputSetup,
  PromptInputTrigger,
} from '../../../ui/agent/PromptInput';
import { cn } from '../../../ui/cn';
import { Popover, PopoverContent, PopoverTrigger } from '../../../ui/Popover';
import { Slider } from '../../../ui/Slider';
import { useChatTabSource } from './ChatSource';
import { llmClient } from './client';

export function ChatModelPicker({
  effort,
  effortLevels,
  model,
  modelUnavailable,
  onEffortSelect,
  onModelSelect,
  providerId,
  side,
}: {
  effort: string | null;
  effortLevels: string[];
  model: string;
  modelUnavailable: boolean;
  onEffortSelect: (level: string) => void;
  onModelSelect: (provider: LlmProviderView, model: string) => void;
  providerId: string | null | undefined;
  side: 'top' | 'bottom';
}) {
  const { navigate } = useChatTabSource();
  const [page, setPage] = useState<'effort' | 'models' | null>(null);
  const [expandedId, setExpandedId] = useState<string | null | undefined>(undefined);
  const [preview, setPreview] = useState<number | null>(null);
  const providerQuery = useQuery({
    queryKey: ['llm', 'providers'],
    queryFn: () => llmClient.list(),
    enabled: Boolean(window.delionBot) && page === 'models',
  });
  const providers = providerQuery.data?.filter((provider) => provider.enabled);
  const expandedProviderId =
    expandedId === undefined
      ? (providers?.find((provider) => provider.id === providerId) ?? providers?.[0])?.id
      : expandedId;
  const activeIndex = Math.max(0, effortLevels.indexOf(effort ?? ''));
  const sliderIndex = preview ?? activeIndex;
  const displayedEffort = effortLevels[sliderIndex] ?? effort ?? 'default';

  const changeOpen = (open: boolean) => {
    setPage(open ? 'effort' : null);
    setExpandedId(undefined);
    setPreview(null);
  };

  const openSettings = () => {
    changeOpen(false);
    navigate({ page: 'settings', section: 'providers' });
  };

  return (
    <Popover onOpenChange={changeOpen} open={page !== null}>
      <PopoverTrigger asChild>
        <PromptInputTrigger
          aria-label="思考强度"
          className={cn(
            'max-w-40 text-ui-headline',
            modelUnavailable && 'text-danger hover:text-danger',
          )}
          title={modelUnavailable ? `${model}（已停用或被移除，请另选模型）` : undefined}
        >
          <span className="truncate">{modelUnavailable ? '模型已停用' : displayedEffort}</span>
          <ChevronDownIcon aria-hidden="true" className="size-4 shrink-0" />
        </PromptInputTrigger>
      </PopoverTrigger>
      <PopoverContent align="end" avoidCollisions={false} className="w-60" side={side}>
        {page !== 'models' && (
          <PromptInputOption
            active={false}
            aria-label="选择模型"
            autoFocus
            className="justify-center"
            onClick={() => setPage('models')}
          >
            <span className="truncate">{displayedEffort}</span>
            <ChevronRightIcon aria-hidden="true" className="size-4 shrink-0" />
          </PromptInputOption>
        )}
        {page === 'models' ? (
          providers === undefined ? (
            <p className="px-2 py-3 text-ui-subhead text-ink-2" role="status">
              {providerQuery.isError ? '模型列表加载失败' : '正在加载模型列表…'}
            </p>
          ) : providers.length === 0 ? (
            <PromptInputSetup
              actionLabel="打开设置 › 模型服务"
              message="还没有启用的模型供应商，可在设置 › 模型服务 中添加或启用。"
              onAction={openSettings}
            />
          ) : (
            <ul
              aria-label="模型服务"
              className="max-h-64 space-y-px overflow-y-auto"
              data-slot="model-list-content"
            >
              {providers.map((provider) => {
                const expanded = provider.id === expandedProviderId;
                const current = provider.id === providerId;
                const Chevron = expanded ? ChevronDownIcon : ChevronRightIcon;
                return (
                  <li key={provider.id}>
                    <PromptInputOption
                      active={false}
                      aria-expanded={expanded}
                      aria-label={current ? `${provider.name}，本会话使用` : undefined}
                      autoFocus={expanded}
                      className="h-auto min-h-control-sm gap-2 rounded-control py-1 text-ui-headline text-ink"
                      onClick={() => setExpandedId(expanded ? null : provider.id)}
                    >
                      <Chevron aria-hidden="true" className="size-4 shrink-0" />
                      <span className="min-w-0 wrap-anywhere">{provider.name}</span>
                      {current && (
                        <span
                          aria-hidden="true"
                          className="ms-auto size-1.5 shrink-0 rounded-full bg-success"
                          title="本会话使用"
                        />
                      )}
                    </PromptInputOption>
                    {expanded && (
                      <ul aria-label="模型" className="mt-px">
                        {provider.models.map((item) => {
                          const selected = provider.id === providerId && model === item;
                          return (
                            <li key={item}>
                              <PromptInputOption
                                active={selected}
                                aria-pressed={selected}
                                className="h-auto min-h-control-sm py-1"
                                onClick={() => {
                                  setPage('effort');
                                  setExpandedId(undefined);
                                  setPreview(null);
                                  if (!selected) onModelSelect(provider, item);
                                }}
                              >
                                <span className="min-w-0 wrap-anywhere">{item}</span>
                                {selected && <PromptInputOptionCheck />}
                              </PromptInputOption>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </li>
                );
              })}
            </ul>
          )
        ) : !modelUnavailable && effortLevels.length > 1 ? (
          <div className="px-2 py-1">
            <Slider
              ariaLabel="思考强度"
              labels={effortLevels}
              max={effortLevels.length - 1}
              onValueChange={setPreview}
              onValueCommit={(index) => {
                const level = effortLevels[index];
                if (level !== undefined && level !== effort) onEffortSelect(level);
              }}
              step={1}
              value={sliderIndex}
            />
          </div>
        ) : !modelUnavailable && effortLevels.length === 0 ? (
          <PromptInputSetup
            actionLabel="打开设置 › 模型服务"
            message="当前模型尚未配置可选的思考强度档位。在设置中编辑当前模型，勾选其支持的档位并保存。"
            onAction={openSettings}
          />
        ) : null}
      </PopoverContent>
    </Popover>
  );
}
