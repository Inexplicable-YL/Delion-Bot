// @vitest-environment jsdom
import { expect, it } from 'vitest';
import { installKeyboardFocus } from '../../../../src/app/renderer/shell/keyboard-focus';

it('只有键盘导航后才显示焦点样式，指针按下后恢复隐藏', () => {
  installKeyboardFocus();
  const keyboardFocus = () => document.documentElement.hasAttribute('data-keyboard-focus');
  const press = (key: string) =>
    document.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));

  press('Enter');
  expect(keyboardFocus()).toBe(false);
  press('Tab');
  expect(keyboardFocus()).toBe(true);
  document.dispatchEvent(new Event('pointerdown', { bubbles: true }));
  expect(keyboardFocus()).toBe(false);
  press('ArrowDown');
  expect(keyboardFocus()).toBe(true);
});
