import '@fontsource-variable/geist';
import '@fontsource-variable/geist-mono';
import './styles/tokens.css';
import './styles/base.css';
import './styles/components.css';
import './styles/matrix.css';
import './styles/flow.css';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { ApiError } from './api/client';
import { live } from './api/live';
import { SessionProvider } from './auth/session';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000,
      // Don't retry what can't succeed by retrying (403, 404, validation).
      retry: (failures, error) => failures < 2 && !(error instanceof ApiError && error.status >= 400 && error.status < 500),
    },
  },
});
// Live updates pushed by the Gateway; queries fall back to polling while the stream is down (api/live.ts).
live.attach(queryClient);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <SessionProvider>
        <App />
      </SessionProvider>
    </QueryClientProvider>
  </StrictMode>,
);
