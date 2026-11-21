import { expect, it } from 'vitest';
import { agentProtocolSchema } from '../../src/core/protocol/schema';

it('协议 schema 与仓库里的 agent.schema.json 一致', async () => {
  await expect(
    `${JSON.stringify(agentProtocolSchema(), null, 2)}\n`,
    '协议变了：只新增可以 -u 更新；删除或修改字段要升 AGENT_PROTOCOL_VERSION',
  ).toMatchFileSnapshot('../../src/core/protocol/agent.schema.json');
});
