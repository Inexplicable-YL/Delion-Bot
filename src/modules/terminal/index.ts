import { app } from 'electron';
import { defineModule } from '../../app/module';
import { implement } from '../../core/protocol/contract';
import { terminalContract } from './contract';
import {
  closeAllTerminals,
  closeProjectTerminals,
  closeTerminal,
  createTerminal,
  listTerminals,
  resizeTerminal,
  writeTerminal,
} from './main/sessions';

export { closeAllTerminals } from './main/sessions';
export { locateBash, prependRuntimePath } from './main/mingit';

export const terminalModule = defineModule({
  id: 'terminal',
  ipc: implement(terminalContract, {
    list: listTerminals,
    create: ({ projectId, id }) => createTerminal(projectId, id),
    write: ({ id, data }) => writeTerminal(id, data),
    resize: ({ id, cols, rows }) => resizeTerminal(id, cols, rows),
    close: closeTerminal,
    closeProject: closeProjectTerminals,
  }),
  register() {
    app.on('will-quit', closeAllTerminals);
  },
});
