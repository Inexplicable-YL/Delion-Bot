import { defineModule } from '../../app/module';
import { implement } from '../../core/protocol/contract';
import { noteContract } from './contract';
import { exportNoteDocument } from './main/export';

export const noteModule = defineModule({
  id: 'note',
  ipc: implement(noteContract, { exportDocument: exportNoteDocument }),
});
