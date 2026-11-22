import { useState } from 'react';
import { ArrowUturnLeftIcon as RotateCcw } from '@heroicons/react/24/outline';
import { Button } from '../../../../ui/Button';
import { Kbd } from '../../../../ui/Kbd';
import {
  acceleratorFromEvent,
  acceleratorKeys,
  findShortcutConflicts,
  isDigitFamily,
  shortcutActions,
  shortcutGroups,
  type ShortcutActionId,
} from '../../../../modules/settings/contract';
import { useShortcuts } from '../../shell/shortcuts';
import { SectionHeader, SettingsGroup } from '../../../../modules/settings/view';
import { showToast } from '../../../../ui/Toast';
import { ErrorText } from '../../../../ui/Alert';
import { errorMessage } from '../../../../core/protocol/contract';

const platform = window.delionBot?.platform === 'darwin' ? 'mac' : 'other';

function acceleratorText(accelerator: string | null, family?: 'digit'): string {
  if (!accelerator) return '未绑定';
  return acceleratorKeys(accelerator, platform, family).join(' + ');
}

export function ShortcutsSection() {
  const bindings = useShortcuts((state) => state.bindings);
  const [recording, setRecording] = useState<ShortcutActionId | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const apply = async (id: ShortcutActionId, accelerator: string | null) => {
    if (busy) return;
    const conflict = findShortcutConflicts({ ...bindings, [id]: accelerator }).find((item) =>
      item.actionIds.includes(id),
    );
    if (conflict) {
      const owner = shortcutActions.find(
        (item) => item.id !== id && conflict.actionIds.includes(item.id),
      )!;
      setError(
        `${acceleratorText(conflict.accelerator)} 已被「${owner.label}」占用，请换一个组合。`,
      );
      return;
    }
    setBusy(true);
    setError(null);
    const failureTitle =
      shortcutActions.find((item) => item.id === id)?.defaultKeys === accelerator
        ? '恢复默认失败'
        : '保存快捷键失败';
    try {
      await useShortcuts.getState().setBinding(id, accelerator);
      setRecording(null);
    } catch (cause) {
      showToast({
        variant: 'error',
        title: failureTitle,
        description: errorMessage(cause),
      });
    }
    setBusy(false);
  };

  const recordKey = (event: KeyboardEvent) => {
    if (!recording) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.key === 'Escape') {
      setRecording(null);
      setError(null);
      return;
    }
    if (event.key === 'Backspace' || event.key === 'Delete') {
      void apply(recording, null);
      return;
    }
    if (['Control', 'Shift', 'Alt', 'Meta'].includes(event.key)) return;
    const accelerator = acceleratorFromEvent(event, platform);
    if (!accelerator) return;
    const action = shortcutActions.find((item) => item.id === recording);
    if (action?.family === 'digit' && !isDigitFamily(accelerator)) {
      setError('该快捷键作用于第 N 个工作组，需要以数字 1…9 结尾。');
      return;
    }
    void apply(recording, accelerator);
  };

  const recordRef = (element: HTMLDivElement | null) => {
    if (!element || !recording) return;
    const onKeyDown = (event: KeyboardEvent) => recordKey(event);
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  };

  const conflicts = findShortcutConflicts(bindings);

  return (
    <div className="grid gap-10" data-setting-id="shortcuts" ref={recordRef}>
      <SectionHeader
        title="快捷键"
        action={
          <Button
            disabled={busy}
            onClick={() => {
              setError(null);
              setBusy(true);
              void useShortcuts
                .getState()
                .resetAll()
                .catch((cause) =>
                  showToast({
                    variant: 'error',
                    title: '恢复默认失败',
                    description: errorMessage(cause),
                  }),
                )
                .finally(() => setBusy(false));
            }}
            size="sm"
            variant="secondary"
          >
            全部恢复默认
          </Button>
        }
      />
      {error && <ErrorText>{error}</ErrorText>}
      {conflicts.length > 0 && (
        <p className="text-ui-subhead text-warning" role="status">
          {conflicts
            .map((conflict) => {
              const labels = conflict.actionIds
                .map((id) => shortcutActions.find((item) => item.id === id)?.label ?? id)
                .join('、');
              const action = shortcutActions.find((item) => item.id === conflict.actionIds[0]);
              return `${acceleratorText(conflict.accelerator, action?.family)} 被「${labels}」共用`;
            })
            .join('；')}
        </p>
      )}
      {shortcutGroups().map((group) => (
        <SettingsGroup key={group.title} title={group.title}>
          {group.actions.map((action) => {
            const accelerator = bindings[action.id];
            const isRecording = recording === action.id;
            return (
              <div
                className="flex items-center justify-between gap-3 border-b py-3 last:border-0"
                data-setting-id={`shortcut-${action.id}`}
                key={action.id}
              >
                <span className="min-w-0 truncate text-ui-body">{action.label}</span>
                <span className="flex shrink-0 items-center gap-1.5">
                  <button
                    aria-label={`修改「${action.label}」的快捷键`}
                    className="rounded-control px-1 py-0.5 transition-colors hover:bg-hover"
                    disabled={busy}
                    onClick={() => {
                      setError(null);
                      setRecording(isRecording ? null : action.id);
                    }}
                    type="button"
                  >
                    {isRecording ? (
                      <span className="text-ui-subhead text-ink-2">按下新的按键…</span>
                    ) : accelerator ? (
                      <span className="flex items-center gap-1">
                        {acceleratorKeys(accelerator, platform, action.family).map((key) => (
                          <Kbd key={key}>{key}</Kbd>
                        ))}
                      </span>
                    ) : (
                      <span className="text-ui-subhead text-ink-2">未绑定</span>
                    )}
                  </button>
                  {accelerator !== action.defaultKeys ? (
                    <Button
                      aria-label={`恢复「${action.label}」的默认快捷键`}
                      disabled={busy}
                      onClick={() => void apply(action.id, action.defaultKeys)}
                      size="icon-xs"
                      title="恢复默认"
                      variant="ghost"
                    >
                      <RotateCcw />
                    </Button>
                  ) : null}
                </span>
              </div>
            );
          })}
        </SettingsGroup>
      ))}
    </div>
  );
}
