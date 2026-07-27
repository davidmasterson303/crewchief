import { QueryClient } from '@tanstack/react-query';

const shouldRetry = (failureCount: number, error: unknown) => {
  if (failureCount > 2) return false;

  if (error instanceof Error) {
    if (error.message.includes('ERR_BLOCKED_BY_CLIENT')) return false;
    if (error.message.includes('NetworkError')) return true;
    if (error.message.includes('timeout')) return true;
  }

  return failureCount < 2;
};

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 5,
      gcTime: 1000 * 60 * 30,
      retry: shouldRetry,
      refetchOnWindowFocus: false,
      refetchOnMount: true,
      refetchOnReconnect: true,
    },
    mutations: {
      retry: 1,
    },
  },
});
