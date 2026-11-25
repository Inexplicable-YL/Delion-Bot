import type { ToolDefinition } from '@earendil-works/pi-coding-agent';

export const ASK_USER_PROMPT = `## Asking the user
When you are unsure what the user wants, call ask_user instead of guessing. Ask before you start the work, so effort does not go into a direction the user would reject.
Ask when:
- The request has more than one reasonable reading and the readings lead to different results.
- Several approaches have real tradeoffs, such as scope, technology, design, structure, or output format, and the conversation does not show which one the user prefers.
- The result depends on a detail that the user has not given and that you cannot find out yourself.
- An action is hard to undo or affects things outside this conversation.
Do not ask about facts you can find by reading files, searching, or running read-only commands. Do not ask about minor choices that have an obvious default. Put related questions in one call. Do not ask the user to choose between options in plain text; use ask_user.`;

export const askUserTool: ToolDefinition = {
  name: 'ask_user',
  label: 'ask_user',
  description:
    'Ask the user one or more multiple-choice questions. The app shows the questions in place of the message input and ends your turn. The user answers in the next message. Call it alone as your last action. Use the reply language. Give each question 2 to 4 concise options. Options are mutually exclusive unless multiple is true. A description appears only on hover, so make each label understandable on its own. The app adds a free-text Other option, so omit it. A skipped question means you should use your judgment.',
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
