/**
 * Environment contract.
 *
 * The storefront ships to a browser, so only Supabase's *publishable* keys may
 * live in `VITE_` variables. Anything privileged belongs in a server route or
 * Supabase Edge Function and must never be prefixed with `VITE_`.
 */

const RAW_URL = import.meta.env.VITE_SUPABASE_URL?.trim() ?? '';

// Supabase now issues `sb_publishable_*` keys; older projects expose the
// `anon` JWT. Both are browser-safe, so both names/variants are accepted.
const RAW_ANON_KEY =
  import.meta.env.VITE_SUPABASE_ANON_KEY?.trim() ||
  import.meta.env.VITE_SUPABASE_KEY?.trim() ||
  '';

const PLACEHOLDER_HINTS = ['your-', 'your_', 'xxxx', 'changeme', 'placeholder'];

/**
 * `sb_secret_*` is the renamed `service_role` key. If it ever ends up in a
 * `VITE_` variable it would be compiled into the public bundle, so refuse to
 * boot and make the mistake obvious instead of shipping a bypass of RLS.
 */
const isSecretKey = RAW_ANON_KEY.startsWith('sb_secret_');

function looksLikePlaceholder(value: string): boolean {
  const lowered = value.toLowerCase();
  return PLACEHOLDER_HINTS.some((hint) => lowered.includes(hint));
}

export const isSupabaseConfigured =
  !isSecretKey &&
  RAW_URL.startsWith('https://') &&
  RAW_URL.includes('.supabase.co') &&
  RAW_ANON_KEY.length > 20 &&
  !looksLikePlaceholder(RAW_URL) &&
  !looksLikePlaceholder(RAW_ANON_KEY);

export const supabaseConfig = {
  url: RAW_URL,
  anonKey: RAW_ANON_KEY,
} as const;

/** Thrown by data hooks so the UI can show a real message instead of a blank page. */
export class ConfigError extends Error {
  constructor() {
    super(
      isSecretKey
        ? 'A Supabase secret (sb_secret_) key was found in a VITE_ variable. Remove it immediately, rotate the key in Supabase, and use the publishable (sb_publishable_) key instead.'
        : 'Supabase is not configured. Copy .env.example to .env and set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.',
    );
    this.name = 'ConfigError';
  }
}
