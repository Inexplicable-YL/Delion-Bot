import { Button } from '../../../ui/Button';
import { DownloadProgressRow } from '../../../ui/DownloadProgress';
import { SettingRow, SettingsGroup } from '../../settings/view';
import { useUpdateState, runUpdateAction, updateView } from './update';

export function UpdateControl() {
  const state = useUpdateState((snapshot) => snapshot.snapshot);

  if (!state) return null;
  const view = updateView(state);
  const action = view.action;

  return (
    <SettingsGroup settingId="app-update">
      <SettingRow
        description={
          <span className="grid gap-0.5">
            <span>当前版本 {state.currentVersion}</span>
            {view.status ? <span role="status">{view.status}</span> : null}
          </span>
        }
        settingId="check-update"
        title="软件更新"
      >
        {view.progress !== null ? (
          <DownloadProgressRow
            barClassName="w-16 md:w-40"
            label="更新下载进度"
            received={state.transferred}
            total={state.total}
          />
        ) : null}
        {action && view.label ? (
          <Button
            onClick={() => {
              if (action === 'install' && state.phase === 'ready')
                useUpdateState.setState({ dismissedVersion: null });
              else void runUpdateAction(action);
            }}
            size="sm"
            variant={action === 'download' || action === 'install' ? 'default' : 'secondary'}
          >
            {view.label}
          </Button>
        ) : null}
      </SettingRow>
    </SettingsGroup>
  );
}
