import { ipcMain } from 'electron';
import { hostPorts } from '../../core/ports';
import { checkWorkspaceSender } from './window';
import type { ModuleDefinition } from '../module';

export function registerModuleIpc(modules: ModuleDefinition[]): void {
  ipcMain.handle('contract:subscribe', (event) => {
    checkWorkspaceSender(event);
    hostPorts().broadcaster.subscribe(event.sender);
  });
  for (const { ipc } of modules) {
    if (!ipc) continue;
    for (const name of Object.keys(ipc.contract.procedures)) {
      ipcMain.handle(`${ipc.contract.namespace}:${name}`, (event, input: unknown) => {
        checkWorkspaceSender(event);
        return ipc.call(name, input);
      });
    }
  }
}
