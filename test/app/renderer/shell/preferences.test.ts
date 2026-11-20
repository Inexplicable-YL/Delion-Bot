// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from 'vitest';

async function loadPreferences() {
  vi.resetModules();
  return (await import('../../../../src/app/renderer/shell/preferences')).usePreferences;
}

beforeEach(() => localStorage.clear());

it('重新加载后仍保留用户设置的侧栏宽度和隐藏的入口', async () => {
  const preferences = await loadPreferences();
  preferences.getState().setPreference('workspaceSidebarWidth', 360);
  preferences.getState().setNavEntryVisible('mail', false);

  expect((await loadPreferences()).getState()).toMatchObject({
    workspaceSidebarWidth: 360,
    hiddenNavEntries: ['mail'],
  });
});
