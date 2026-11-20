// 模块清单：主进程据此注册各模块的 IPC 与后台任务。
import type { ModuleDefinition } from './module';
import { chatModule } from '../modules/chat';
import { connectorsModule } from '../modules/connectors';
import { notificationsModule } from '../modules/notifications';
import { onboardingModule } from '../modules/onboarding';
import { previewModule } from '../modules/preview';
import { remotesModule } from '../modules/remotes';
import { searchModule } from '../modules/search';
import { settingsModule } from '../modules/settings';
import { terminalModule } from '../modules/terminal';
import { todoModule } from '../modules/todo';
import { updateModule } from '../modules/update';
import { workspaceModule } from '../modules/workspace';

export const modules: ModuleDefinition[] = [
  workspaceModule,
  previewModule,
  remotesModule,
  terminalModule,
  chatModule,
  connectorsModule,
  settingsModule,
  updateModule,
  onboardingModule,
  searchModule,
  todoModule,
  notificationsModule,
];
