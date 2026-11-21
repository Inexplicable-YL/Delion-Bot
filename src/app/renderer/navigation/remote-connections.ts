import { useQuery } from '@tanstack/react-query';
import type { RemoteConnection } from '../../../modules/remotes/contract';
import { remoteConnectionsQuery } from '../../../modules/remotes/view';

const byId = (list: RemoteConnection[]) => Object.fromEntries(list.map((item) => [item.id, item]));
const noConnections: Record<string, RemoteConnection> = {};

export function useRemoteConnections(): Record<string, RemoteConnection> {
  return useQuery({ ...remoteConnectionsQuery, select: byId }).data ?? noConnections;
}

export function remoteDestination(connection: RemoteConnection | undefined): string | undefined {
  if (!connection) return undefined;
  return connection.port ? `${connection.host}:${connection.port}` : connection.host;
}
