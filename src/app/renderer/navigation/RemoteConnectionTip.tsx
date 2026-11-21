import type { WorkspaceEntry } from '../../../modules/workspace/contract';
import type { RemoteConnection } from '../../../modules/remotes/contract';
import type { RemoteActivity } from './remote-activity';
import { remoteDestination } from './remote-connections';

export function RemoteConnectionTip({
  project,
  connection,
  activity,
}: {
  project: WorkspaceEntry;
  connection?: RemoteConnection;
  activity?: RemoteActivity;
}) {
  return (
    <div className="grid gap-0.5 text-left font-normal">
      <span className="font-medium">{project.name}</span>
      <span>
        {remoteDestination(connection) ?? '远程项目'}
        {project.path ? ` · ${project.path}` : ''}
      </span>
      {activity?.phase === 'connecting' && <span>正在连接…</span>}

      {activity?.phase === 'failed' && <span>{activity.reason}</span>}
    </div>
  );
}
