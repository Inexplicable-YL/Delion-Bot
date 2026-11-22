import { expect, it } from 'vitest';
import type { AgentToolResult } from '../../../../src/core/protocol/agent';
import { replySources } from '../../../../src/modules/chat/view/reply-sources';

it('合并搜索与网页读取结果，保留连接器返回的邮件和资源链接', () => {
  const url = 'https://example.com/date';
  const steps: AgentToolResult[] = [
    {
      id: '1',
      name: 'web_search',
      input: {},
      output: { text: JSON.stringify({ provider: 'brave', results: [{ title: 'Today', url }] }) },
    },
    {
      id: '2',
      name: 'web_fetch',
      input: { url },
      output: { text: JSON.stringify({ source: { url }, title: null }) },
    },
    {
      id: '3',
      name: 'mcp_Composio_COMPOSIO_SEARCH_TOOLS',
      input: {},
      output: { text: '{}' },
    },
    {
      id: '4',
      name: 'mcp_Composio_COMPOSIO_MULTI_EXECUTE_TOOL',
      input: {},
      output: {
        text: JSON.stringify({
          data: {
            results: [
              {
                tool_slug: 'GMAIL_FETCH_EMAILS',
                response: {
                  data: {
                    messages: [
                      {
                        id: 'message-id',
                        payload: { headers: [{ name: 'Subject', value: 'Security alert' }] },
                      },
                    ],
                  },
                },
              },
            ],
          },
        }),
      },
    },
    {
      id: '5',
      name: 'mcp_Docs_search',
      input: {},
      output: {
        text: '',
        details: {
          source: { name: 'Docs', domain: 'docs.example.com' },
          links: [
            { title: 'Guide', url: 'https://docs.example.com/guide' },
            { title: 'Local file', url: 'file:///guide' },
          ],
        },
      },
    },
  ];

  expect(replySources(steps, [{ slug: 'gmail', name: 'Gmail', logo: 'gmail.svg' }])).toMatchObject([
    { title: 'Today', domain: 'example.com', url },
    { title: 'Security alert', domain: 'mail.google.com', logo: 'gmail.svg' },
    { title: 'Guide', domain: 'docs.example.com', url: 'https://docs.example.com/guide' },
  ]);
});
