import { z } from 'zod';
import { defineContract } from '../../core/protocol/contract';
import { isAccelerator, isShortcutActionId, type KeybindingOverrides } from './keybindings';

export * from './keybindings';

export type ThemePreference = 'system' | 'light' | 'dark';

export type IconPreference = 'white' | 'black';

export const zoomLevels = [0.9, 1, 1.1, 1.25, 1.5] as const;
export type ZoomPreference = (typeof zoomLevels)[number];

export const fontSizeMin = 12;
export const fontSizeMax = 20;
export const fontSizeDefault = 16;

export interface TaskNotificationPrefs {
  completed: boolean;
  failed: boolean;
}

export type SettingsSectionId =
  | 'general'
  | 'appearance'
  | 'shortcuts'
  | 'notifications'
  | 'storage'
  | 'providers'
  | 'capabilities'
  | 'commands'
  | 'skills'
  | 'workspace'
  | 'remotes'
  | 'archived'
  | 'about'
  | 'privacy'
  | 'terms';

export const settingsSectionLabels: Record<SettingsSectionId, string> = {
  general: '通用',
  appearance: '外观',
  shortcuts: '快捷键',
  notifications: '通知',
  storage: '存储',
  providers: '模型服务',
  capabilities: '内置能力',
  commands: '自定义指令',
  skills: 'Skills',
  workspace: '工作区',
  remotes: '远程',
  archived: '已归档对话',
  about: '关于',
  privacy: '隐私条款',
  terms: '使用条款',
};

export type BackupResult =
  | { status: 'exported'; path: string; skipped: string[] }
  | { status: 'cancelled' }
  | { status: 'failed'; reason: string };

export interface CacheClearResult {
  freed: number;
  blocked: boolean;
}

export const themeSchema = z.enum(['system', 'light', 'dark']);
export const iconSchema = z.enum(['white', 'black']);
export const zoomSchema = z.literal(zoomLevels);
export const taskNotificationsSchema = z.object({ completed: z.boolean(), failed: z.boolean() });
export const keybindingOverridesSchema = z.record(
  z.string().refine(isShortcutActionId),
  z.union([z.null(), z.string().refine(isAccelerator)]),
);

export const settingsContract = defineContract('settings', {
  theme: { input: z.undefined(), output: z.custom<ThemePreference>() },
  setTheme: { input: themeSchema, output: z.custom<ThemePreference>() },
  icon: { input: z.undefined(), output: z.custom<IconPreference>() },
  setIcon: { input: iconSchema, output: z.custom<IconPreference>() },
  zoom: { input: z.undefined(), output: z.custom<ZoomPreference>() },
  setZoom: { input: zoomSchema, output: z.custom<ZoomPreference>() },
  fontSize: { input: z.undefined(), output: z.number() },
  setFontSize: { input: z.number(), output: z.number() },
  openAtLogin: { input: z.undefined(), output: z.boolean() },
  setOpenAtLogin: { input: z.boolean(), output: z.boolean() },
  taskNotifications: { input: z.undefined(), output: z.custom<TaskNotificationPrefs>() },
  setTaskNotifications: {
    input: taskNotificationsSchema,
    output: z.custom<TaskNotificationPrefs>(),
  },
  keybindings: { input: z.undefined(), output: z.custom<KeybindingOverrides>() },
  setKeybindings: { input: keybindingOverridesSchema, output: z.custom<KeybindingOverrides>() },
  resetKeybindings: { input: z.undefined(), output: z.custom<KeybindingOverrides>() },
  instruction: { input: z.undefined(), output: z.string() },
  setInstruction: { input: z.string(), output: z.string() },
  exportData: { input: z.undefined(), output: z.custom<BackupResult>() },
  cacheSize: { input: z.undefined(), output: z.number() },
  clearCache: { input: z.undefined(), output: z.custom<CacheClearResult>() },
});

declare module '../../app/module' {
  interface NavTargets {
    settings: { section: SettingsSectionId };
  }
}
