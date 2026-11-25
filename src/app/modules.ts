import type { ModuleDefinition } from './module';
import { chatModule } from '../modules/chat';
import { connectorsModule } from '../modules/connectors';
import { noteModule } from '../modules/note';
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
  noteModule,
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
