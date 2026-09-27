import { QueryClient } from '@tanstack/react-query';
import { ConfigError, isSupabaseConfigured } from '@/lib/env';

function isRetryable(error: unknown): boolean {
  // A configuration problem will never fix itself on retry.
  if (error instanceof ConfigError) return false;
  return true;
}

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60 * 1000,
      gcTime: 10 * 60 * 1000,
      refetchOnWindowFocus: false,
      retry: (failureCount, error) => (failureCount < 2 && isRetryable(error)),
      retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 8000),
    },
    mutations: {
      retry: false,
    },
  },
});

/**
 * Called once at startup so a missing `.env` produces one clear console warning
 * instead of a wall of failing requests.
 */
export function reportConfigurationStatus(): void {
  if (!isSupabaseConfigured) {
    console.warn(
      '[kaal-vastr] Supabase is not configured. Copy .env.example to .env, add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY, then restart the dev server.',
    );
  }
}
