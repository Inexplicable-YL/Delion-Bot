import { defineModule } from '../../app/module';
import { helperSession, helperStates, onHelperState, retryHelper } from '../../core/remote/helper';
import { emit } from '../../core/ports';
import { implement } from '../../core/protocol/contract';
import { remotesContract } from './contract';
import { pickKeyFile } from './main/actions';
import {
  browseRemote,
  configHostCandidates,
  createRemoteDirectory,
  listRemotes,
  prepareRemote,
  probeConnection,
  remoteById,
  removeRemote,
  saveRemote,
  targetOf,
} from './main/api';

export { remoteById, remoteJoin, targetOf, withinRemoteRoot } from './main/api';
export { readRemoteDocument, remoteDocumentMime } from './main/documents';
export {
  closeAllPortTunnels,
  closeRemotePort,
  openRemotePort,
  remotePortsState,
} from './main/ports';
export {
  closeRemoteOpens,
  downloadRemoteFile,
  openRemoteFile,
  uploadLocalFile,
} from './main/transfer';

const targetById = (id: string) => targetOf(remoteById(id));

export const remotesModule = defineModule({
  id: 'remotes',
  ipc: implement(remotesContract, {
    list: listRemotes,
    save: saveRemote,
    remove: removeRemote,
    probe: probeConnection,
    browse: ({ draft, path }) => browseRemote(draft, path),
    mkdir: ({ draft, parent, name }) => createRemoteDirectory(draft, parent, name),
    pickKey: pickKeyFile,
    configHosts: configHostCandidates,
    prepare: (draft) =>
      prepareRemote(draft, (progress) => emit(remotesContract, 'setupProgress', progress)),
    helperStates,
    tasks: (id) => helperSession(targetById(id)).listTasks(),
    cancelTask: ({ remoteId, taskId }) => helperSession(targetById(remoteId)).cancelTask(taskId),
    retry: (id) => retryHelper(targetById(id)),
  }),
  register() {
    onHelperState((states) => emit(remotesContract, 'helperState', states));
  },
});
