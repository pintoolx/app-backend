'use client';

import * as React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from '@/components/ui/sonner';

/**
 * Lazily-instantiated QueryClient, scoped per render boundary so dev HMR
 * doesn't leak state across reloads. Defaults are conservative — we let
 * individual hooks override staleTime where appropriate.
 */
function makeClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        retry: (failureCount, error) => {
          const status = (error as { status?: number } | null)?.status;
          if (status === 401 || status === 403) return false;
          return failureCount < 2;
        },
        refetchOnWindowFocus: false,
      },
      mutations: {
        retry: 0,
      },
    },
  });
}

export function QueryProvider({ children }: { children: React.ReactNode }) {
  const [client] = React.useState(makeClient);

  React.useEffect(() => {
    document.body.dataset.adminHydrated = 'true';

    return () => {
      delete document.body.dataset.adminHydrated;
    };
  }, []);

  return (
    <QueryClientProvider client={client}>
      {children}
      <Toaster />
    </QueryClientProvider>
  );
}
