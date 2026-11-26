import { expect, it } from 'vitest';
import { connectorStep } from '../../../../src/modules/chat/view/connector-steps';

const catalog = [
  { slug: 'gmail', name: 'Gmail', logo: 'gmail.svg' },
  { slug: 'one_drive', name: 'OneDrive', logo: 'one-drive.svg' },
] as const;

it('连接器执行步骤显示应用名与动作，按最长工具集前缀识别应用', () => {
  const step = connectorStep(
    'mcp_Composio_COMPOSIO_MULTI_EXECUTE_TOOL',
    {
      tools: [
        { tool_slug: 'GMAIL_SEND_EMAIL', arguments: {} },
        { tool_slug: 'ONE_DRIVE_LIST_FILES', arguments: {} },
      ],
    },
    [...catalog],
  );
  expect(step.done).toBe('使用 Gmail、OneDrive');
  expect(step.target).toBe('send email、list files');
});

it('输入缺字段或应用未知时回退为通用连接器文案', () => {
  const step = connectorStep('mcp_Composio_COMPOSIO_MULTI_EXECUTE_TOOL', null, [...catalog]);
  expect(step).toMatchObject({ done: '使用连接器', target: '', apps: [] });
});

it('Pipedream 工具按服务器前缀识别应用，动作取自工具名', () => {
  const step = connectorStep('mcp_Pipedream_one_drive_list-files', {}, [...catalog]);
  expect(step).toMatchObject({ done: '使用 OneDrive', target: 'list files' });
  expect(step.apps.map((app) => app.slug)).toEqual(['one_drive']);
});
