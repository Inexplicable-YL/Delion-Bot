import { defineModule } from '../../app/module';
import { registerCommandDomain } from '../../core/capabilities/commands';
import { implement } from '../../core/protocol/contract';
import { registerSearchProvider } from '../search';
import { todoContract } from './contract';
import { todoDomain } from './main/agent';
import { todoSearch } from './main/search';
import { getTodoState, removeTodo, saveTodo } from './main/store';

export const todoModule = defineModule({
  id: 'todo',
  ipc: implement(todoContract, {
    state: getTodoState,
    save: saveTodo,
    remove: removeTodo,
  }),
  register() {
    registerCommandDomain(todoDomain);
    registerSearchProvider(todoSearch);
  },
});
