import { defineModule } from '../../app/module';
import { implement } from '../../core/protocol/contract';
import { searchContract } from './contract';
import { querySearch } from './main/registry';

export { likePattern, registerSearchProvider, type SearchProvider } from './main/registry';

export const searchModule = defineModule({
  id: 'search',
  ipc: implement(searchContract, { query: querySearch }),
});
