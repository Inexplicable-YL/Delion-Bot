import { expect, it } from 'vitest';
import {
  formatAskAnswer,
  parseAskAnswer,
  parseAskCard,
} from '../../../../src/modules/chat/view/ask-card';

it('解析问题行与带说明的选项', () => {
  expect(parseAskCard('用哪种数据库？\n- PostgreSQL | 适合复杂查询\n- SQLite')).toEqual([
    {
      question: '用哪种数据库？',
      options: [{ label: 'PostgreSQL', description: '适合复杂查询' }, { label: 'SQLite' }],
    },
  ]);
});

it('容忍编号、加粗、问题前缀，并去掉模型自带的“其他”与重复选项', () => {
  expect(
    parseAskCard(
      '\n**问题：选哪个？**\n\n1. **甲** ｜ 快\n2) 乙 — 稳\n   适合长期维护\n3. 甲\n- 其他（请说明）\n',
    ),
  ).toEqual([
    {
      question: '选哪个？',
      options: [
        { label: '甲', description: '快' },
        { label: '乙', description: '稳 适合长期维护' },
      ],
    },
  ]);
});

it('选项之后不缩进的文字开始新的问题组，无效的组被丢弃', () => {
  expect(
    parseAskCard(
      '用哪种数据库？\n- PostgreSQL\n- SQLite\n\n需要登录吗？\n- 需要\n- 不需要\n\n孤立的问题',
    ),
  ).toEqual([
    { question: '用哪种数据库？', options: [{ label: 'PostgreSQL' }, { label: 'SQLite' }] },
    { question: '需要登录吗？', options: [{ label: '需要' }, { label: '不需要' }] },
  ]);
});

it('兼容 JSON 写法，包括多个问题组', () => {
  expect(
    parseAskCard(
      '[{"question":"继续吗？","options":["继续",{"label":"停止","description":"保留现状"}]},{"question":"现在？","options":["是"]}]',
    ),
  ).toEqual([
    {
      question: '继续吗？',
      options: [{ label: '继续' }, { label: '停止', description: '保留现状' }],
    },
    { question: '现在？', options: [{ label: '是' }] },
  ]);
});

it.each(['只有问题没有选项', '- 只有选项', '- 其他'])('无法构成卡片时返回 null：%s', (source) => {
  expect(parseAskCard(source)).toBeNull();
});

it('答案能还原到对应的问题组', () => {
  const single = [{ question: '用哪种？', options: [{ label: 'A' }] }];
  expect(formatAskAnswer(single, ['MySQL'])).toBe('MySQL');
  expect(parseAskAnswer(single, 'MySQL')).toEqual(['MySQL']);

  const groups = [
    { question: '用哪种\n数据库？', options: [{ label: 'SQLite' }] },
    { question: '需要登录吗？', options: [{ label: '需要' }] },
  ];
  const text = formatAskAnswer(groups, ['SQLite', '看情况']);
  expect(text).toBe('用哪种 数据库？：SQLite\n需要登录吗？：看情况');
  expect(parseAskAnswer(groups, text)).toEqual(['SQLite', '看情况']);
  expect(parseAskAnswer(groups, '随便聊点别的')).toEqual([undefined, undefined]);
});

it('跳过的问题在答案里显式标出，并还原为未作答', () => {
  const single = [{ question: '用哪种？', options: [{ label: 'A' }] }];
  expect(formatAskAnswer(single, [undefined])).toBe('用哪种？：（跳过）');
  expect(parseAskAnswer(single, '用哪种？：（跳过）')).toEqual([undefined]);
});
