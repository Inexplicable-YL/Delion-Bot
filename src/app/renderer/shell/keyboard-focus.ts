const navigationKeys = new Set([
  'Tab',
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'Home',
  'End',
  'PageUp',
  'PageDown',
]);

export function installKeyboardFocus() {
  const root = document.documentElement;
  document.addEventListener(
    'keydown',
    (event) => {
      if (navigationKeys.has(event.key)) root.dataset.keyboardFocus = '';
    },
    true,
  );
  document.addEventListener('pointerdown', () => delete root.dataset.keyboardFocus, true);
}
