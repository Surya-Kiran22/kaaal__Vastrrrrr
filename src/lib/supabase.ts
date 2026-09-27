import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { isSupabaseConfigured, supabaseConfig } from './env';

/**
 * A single browser Supabase client for the whole app.
 *
 * When env vars are missing we still hand back a client (so the shell renders
 * and `npm run build` never explodes), but every data hook checks
 * `isSupabaseConfigured` first and surfaces a configuration notice instead of a
 * network error.
 */
export const supabase: SupabaseClient = createClient(
  isSupabaseConfigured ? supabaseConfig.url : 'https://placeholder.supabase.co',
  isSupabaseConfigured ? supabaseConfig.anonKey : 'placeholder-anon-key-placeholder',
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      storageKey: 'kaal-vastr.auth',
    },
    global: {
      headers: { 'x-application-name': 'kaal-vastr-storefront' },
    },
  },
);
