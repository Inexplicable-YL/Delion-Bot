import { lazy } from 'react';

export { onTerminalEvent, terminalClient } from './client';

export const TerminalTab = lazy(() =>
  import('./TerminalTab').then((module) => ({ default: module.TerminalTab })),
);
