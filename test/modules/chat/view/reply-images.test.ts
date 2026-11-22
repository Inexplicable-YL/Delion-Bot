import { expect, it } from 'vitest';
import {
  GALLERY_MAX_HEIGHT,
  GALLERY_MIN_HEIGHT,
  galleryLayout,
} from '../../../../src/modules/chat/view/reply-images';

it('放得下时多图按单图高度的 2/3 并排', () => {
  expect(galleryLayout([1, 1], 1000)).toEqual({
    height: GALLERY_MAX_HEIGHT,
    shown: 2,
    overflow: false,
  });
});

it('放不下时在 1/2 到 2/3 高度之间缩放以容纳全部图片', () => {
  const { height, shown } = galleryLayout([2, 2], 2 * 2 * 90 + 8);

  expect(shown).toBe(2);
  expect(height).toBeCloseTo(90);
});

it('缩到 1/2 高度仍放不下时，最后一格显示剩余张数', () => {
  expect(galleryLayout([2, 2, 2, 2], 500)).toEqual({
    height: GALLERY_MIN_HEIGHT,
    shown: 3,
    overflow: true,
  });
});

it('只有最后一张放不下时也收成计数格，而不是被裁掉', () => {
  expect(galleryLayout([3, 1.3, 1, 3], 640)).toEqual({
    height: GALLERY_MIN_HEIGHT,
    shown: 4,
    overflow: true,
  });
});
