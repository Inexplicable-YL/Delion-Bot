import { expect, it } from 'vitest';
import { askUserTool } from '../../../src/core/capabilities/ask-user';

const ask = (options: { label: string; description?: string }[]) =>
  askUserTool.execute(
    'call',
    { questions: [{ question: '用哪种数据库？', options }] } as never,
    undefined,
    undefined,
    undefined as never,
  );

it('同一问题的选项要么都写说明，要么都不写', async () => {
  await expect(ask([{ label: 'A' }, { label: 'B' }])).resolves.toMatchObject({ terminate: true });
  await expect(
    ask([
      { label: 'A', description: '甲' },
      { label: 'B', description: '乙' },
    ]),
  ).resolves.toMatchObject({ terminate: true });
  await expect(ask([{ label: 'A', description: '甲' }, { label: 'B' }])).rejects.toThrow(
    '用哪种数据库？',
  );
});
