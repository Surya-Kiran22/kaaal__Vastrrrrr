import { useEffect, useState } from 'react';
import { useQuery, useQueryClient, type UseQueryOptions } from '@tanstack/react-query';
import { isSupabaseConfigured } from '@/lib/env';
import { supabase } from '@/lib/supabase';

export type LiveStatus = 'connecting' | 'live' | 'polling';

/** Cadence used only when the push socket is not delivering. */
export const POLL_FALLBACK = 30_000;

export interface LiveSyncOptions {
  /** Tables whose changes should refresh this query. */
  tables: string[];
}

/**
 * Keeps a screen in sync with the database without exposing a refresh button.
 *
 * Two mechanisms run at once, deliberately:
 *
 *  - a Postgres change subscription that pushes updates as they happen;
 *  - a slow poll that keeps running whether or not that subscription works.
 *
 * The poll is the safety net. Realtime degrades to a dead socket on flaky
 * mobile data, and some proxies and extensions block websockets outright, so
 * trusting the subscription alone means showing stale dispatch statuses with no
 * way for the user to recover.
 */
export function useRealtimeSync({ tables }: LiveSyncOptions): LiveStatus {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<LiveStatus>('connecting');

  const tableKey = tables.join(',');

  useEffect(() => {
    if (!isSupabaseConfigured || tableKey.length === 0) {
      setStatus('polling');
      return;
    }

    let cancelled = false;
    const channel = supabase.channel(`kv-sync:${tableKey}:${Math.random().toString(36).slice(2, 8)}`);

    for (const table of tableKey.split(',')) {
      channel.on('postgres_changes', { event: '*', schema: 'public', table }, () => {
        if (cancelled) return;
        void queryClient.invalidateQueries();
      });
    }

    void channel.subscribe((state) => {
      if (cancelled) return;
      if (state === 'SUBSCRIBED') setStatus('live');
      // CHANNEL_ERROR and TIMED_OUT both mean "no push available".
      if (state === 'CHANNEL_ERROR' || state === 'TIMED_OUT') setStatus('polling');
    });

    // If the handshake has not succeeded shortly after mount, assume the socket
    // is not going to work and let polling carry the screen on its own.
    const settle = setTimeout(() => {
      if (!cancelled) setStatus((current) => (current === 'connecting' ? 'polling' : current));
    }, 4000);

    return () => {
      cancelled = true;
      clearTimeout(settle);
      void supabase.removeChannel(channel);
    };
  }, [tableKey, queryClient]);

  return status;
}

/**
 * `useQuery` plus live updates. Pass the tables the screen depends on and the
 * query refreshes itself — there is deliberately no way to ask for a manual
 * refresh from the UI.
 */
export function useLiveQuery<TData, TError = Error>(
  options: UseQueryOptions<TData, TError>,
  sync: LiveSyncOptions,
) {
  const status = useRealtimeSync(sync);

  return useQuery<TData, TError>({
    ...options,
    // While push works, polling would only add load. When it does not, the poll
    // is the only thing keeping the screen honest.
    refetchInterval: status === 'live' ? false : POLL_FALLBACK,
    refetchIntervalInBackground: false,
  });
}
