import { StrictMode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createRoot } from 'react-dom/client';
import { contracts } from '../contracts';
import { views } from '../views';
import { useUpdateState } from '../../modules/update/view';
import { ErrorBoundary } from './shell/ErrorBoundary';
import App, { connectAppEvents } from './shell/App';
import { connectQueryEvents } from './shell/query-events';
import { saveWorkspace } from './shell/save-workspace';
import { connectLocalWorkspaceQueries } from './navigation/remote-references';
import { useNavigationStore } from './navigation/view';
import { useShortcuts } from './shell/shortcuts';
import { connectAppearance } from './shell/theme';
import { installTitleTooltips } from './shell/title-tooltip';
import { useWorkspaceStore } from '../../modules/workspace/view';
import './styles/globals.css';

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
});
connectQueryEvents(queryClient, contracts, window.delionBot?.bridge);
for (const view of views) view.start?.(useNavigationStore.getState().navigate);
useUpdateState.setState({ beforeInstall: saveWorkspace });
void useWorkspaceStore.getState().load();
void useShortcuts.getState().load();

connectAppearance(queryClient);
connectAppEvents();
connectLocalWorkspaceQueries(queryClient);
window.delionBot?.window.onStateChange((state) =>
  queryClient.setQueryData(['window', 'state'], state),
);
installTitleTooltips();
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary title="应用遇到错误">
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>
    </ErrorBoundary>
  </StrictMode>,
);
