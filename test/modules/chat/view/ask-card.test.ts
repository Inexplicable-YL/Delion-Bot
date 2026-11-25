import { expect, it } from 'vitest';
import type { WorkspaceChat } from '../../../../src/core/protocol/agent';
import { formatAskAnswer, pendingAsk } from '../../../../src/modules/chat/view/ask-card';

const questions = [{ question: '用哪种？', options: [{ label: 'A' }, { label: 'B' }] }];
const askCall = (input: unknown = { questions }) => ({
  id: 'call-1',
  name: 'ask_user',
  input,
  output: { text: 'shown' },
});
const reply = (results: ReturnType<typeof askCall>[]): WorkspaceChat['messages'][number] => ({
  role: 'assistant',
  content: '',
  parts: [{ type: 'tools', results }],
});

it('回复以 ask_user 结束时给出待回答的问题', () => {
  expect(pendingAsk([{ role: 'user', content: '帮我选' }, reply([askCall()])])).toEqual({
    id: 'call-1',
    groups: questions,
  });
});

it('用户已经回复、回复继续写了正文或参数无效时不再询问', () => {
  expect(pendingAsk([reply([askCall()]), { role: 'user', content: '用哪种？：A' }])).toBeNull();
  expect(
    pendingAsk([
      {
        ...reply([askCall()]),
        parts: [...reply([askCall()]).parts!, { type: 'text', text: '好' }],
      },
    ]),
  ).toBeNull();
  expect(pendingAsk([reply([askCall({ questions: [] })])])).toBeNull();
});

it('答案按问题逐行发出，多选用顿号连接，跳过的问题显式标出', () => {
  const groups = [
    { question: '用哪种\n数据库？', options: [{ label: 'SQLite' }] },
    { question: '支持哪些？', options: [{ label: 'Web' }], multiple: true },
    { question: '需要登录吗？', options: [{ label: '需要' }] },
  ];
  expect(formatAskAnswer(groups, [['SQLite'], ['Web', 'iOS'], []])).toBe(
    '用哪种 数据库？：SQLite\n支持哪些？：Web、iOS\n需要登录吗？：（跳过）',
  );
});
