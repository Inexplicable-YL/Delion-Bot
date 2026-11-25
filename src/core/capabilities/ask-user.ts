import type { ToolDefinition } from '@earendil-works/pi-coding-agent';

export const askUserTool: ToolDefinition = {
  name: 'ask_user',
  label: 'ask_user',
  description:
    'Ask the user to choose among clear options when progress requires a decision you cannot reasonably make on your own. The app shows the questions in place of the message input and ends your turn. The user answers in the next message. Call it alone as your last action. Use the reply language. Give each question 2 to 4 concise options. Options are mutually exclusive unless multiple is true. A description appears only on hover, so make each label understandable on its own. The app adds a free-text Other option, so omit it. A skipped question means you should use your judgment.',
  parameters: {
    type: 'object',
    properties: {
      questions: {
        type: 'array',
        minItems: 1,
        items: {
          type: 'object',
          properties: {
            question: { type: 'string' },
            multiple: { type: 'boolean' },
            options: {
              type: 'array',
              minItems: 1,
              items: {
                type: 'object',
                properties: { label: { type: 'string' }, description: { type: 'string' } },
                required: ['label'],
              },
            },
          },
          required: ['question', 'options'],
        },
      },
    },
    required: ['questions'],
  } as unknown as ToolDefinition['parameters'],
  execute: async () => ({
    content: [{ type: 'text', text: 'The questions are shown to the user. Wait for the reply.' }],
    details: undefined,
    terminate: true,
  }),
};
