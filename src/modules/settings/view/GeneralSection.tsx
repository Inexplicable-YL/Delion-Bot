import { useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Switch } from '../../../ui/Switch';
import { SectionHeader } from './SectionHeader';
import { SettingRow } from './SettingRow';
import { SettingsGroup } from './SettingsGroup';
import { settingsClient } from './client';
import { showToast } from '../../../ui/Toast';
import { UpdateControl } from '../../update/view';
import { errorMessage } from '../../../core/protocol/contract';

export function GeneralSection({ navEntries }: { navEntries: ReactNode }) {
  const queryClient = useQueryClient();
  const openAtLogin = useQuery({
    queryKey: ['settings', 'openAtLogin'],
    queryFn: () => settingsClient.openAtLogin().catch(() => false),
    enabled: Boolean(window.delionBot),
  }).data;
  const [busy, setBusy] = useState(false);

  const toggleOpenAtLogin = async (next: boolean) => {
    if (busy) return;
    setBusy(true);
    const save = async () => {
      queryClient.setQueryData(
        ['settings', 'openAtLogin'],
        window.delionBot ? await settingsClient.setOpenAtLogin(next) : next,
      );
    };
    try {
      await save();
    } catch (cause) {
      showToast({ variant: 'error', title: '保存失败', description: errorMessage(cause) });
    }
    setBusy(false);
  };

  return (
    <div className="grid gap-10">
      <SectionHeader title="通用" />
      <div className="grid gap-2">
        <SettingsGroup title="启动">
          <SettingRow settingId="open-at-login" title="开机自启动">
            <Switch
              checked={openAtLogin ?? false}
              disabled={openAtLogin === undefined || busy}
              label="开机自启动"
              onChange={(next) => void toggleOpenAtLogin(next)}
            />
          </SettingRow>
        </SettingsGroup>
      </div>
      {navEntries}
      <UpdateControl />
    </div>
  );
}
