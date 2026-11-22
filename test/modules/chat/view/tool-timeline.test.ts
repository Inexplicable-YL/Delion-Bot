// @vitest-environment jsdom
import { expect, it } from 'vitest';
import { formatElapsed } from '../../../../src/modules/chat/view/ToolTimeline';

it('处理时长只显示已进位到的单位', () => {
  expect(formatElapsed(999)).toBe('0 秒');
  expect(formatElapsed(61_000)).toBe('1 分 1 秒');
  expect(formatElapsed(3_605_000)).toBe('1 时 0 分 5 秒');
});
