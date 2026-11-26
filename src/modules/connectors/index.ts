import { defineModule } from '../../app/module';
import { invalidateSessions } from '../../core/agent/session/run';
import { hostPorts, registerSecretLabel } from '../../core/ports';
import { implement } from '../../core/protocol/contract';
import { provideManagedMcp } from '../../core/capabilities/mcp';
import { connectorsContract, provider, providerNames } from './contract';
import * as composio from './main/composio';
import * as pipedream from './main/pipedream';

const services = { composio, pipedream };

function active() {
  return provider.safeParse(hostPorts().secrets.read('connector-provider')).data ?? null;
}

export const connectorsModule = defineModule({
  id: 'connectors',
  register() {
    registerSecretLabel('composio', 'Composio 连接器');
    registerSecretLabel('pipedream', 'Pipedream 连接器');
    registerSecretLabel('connector-provider', '已启用的连接器供应商');
    provideManagedMcp(async () => {
      const current = active();
      if (current === 'composio') return composio.mcp();
      if (current === 'pipedream') return pipedream.mcp().catch(() => []);
      return [];
    });
  },
  ipc: implement(connectorsContract, {
    status: () => ({
      active: active(),
      configured: {
        composio: Boolean(composio.saved()),
        pipedream: Boolean(pipedream.saved()),
      },
    }),
    async activate(next) {
      if (next && !services[next].saved()) throw new Error(`请先配置 ${providerNames[next]}。`);
      if (next) hostPorts().secrets.write('connector-provider', next);
      else hostPorts().secrets.remove('connector-provider');
      invalidateSessions();
    },
    async setup(input) {
      if (input.provider === 'composio') await composio.setup(input.key);
      else await pipedream.setup(input);
      invalidateSessions();
    },
    catalog: (name) => services[name].catalog(),
    accounts: (name) => services[name].accounts(),
    connect: ({ provider: name, slug }) => services[name].connect(slug),
    disconnect: ({ provider: name, id }) => services[name].disconnect(id),
  }),
});
