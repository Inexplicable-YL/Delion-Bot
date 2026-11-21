import { defineModule } from '../../app/module';
import { implement } from '../../core/protocol/contract';
import { updateContract } from './contract';
import {
  beginCheck,
  beginDownload,
  beginInstall,
  currentState,
  deferInstall,
  startBackgroundUpdateCheck,
} from './main/updater';

export const updateModule = defineModule({
  id: 'update',
  ipc: implement(updateContract, {
    state: currentState,
    check: beginCheck,
    download: beginDownload,
    install: beginInstall,
    deferInstall,
  }),
  start: startBackgroundUpdateCheck,
});
