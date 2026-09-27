import { Link, Outlet, useRouterState } from '@tanstack/react-router';
import { LogOut, MapPin, Package, UserRound } from 'lucide-react';
import { useEffect } from 'react';
import { ErrorBoundary } from '@/components/ui/error-boundary';
import { useAuth } from '@/hooks/useAuth';
import { isSupabaseConfigured } from '@/lib/env';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

const TABS = [
  { to: '/account', label: 'Profile', icon: UserRound },
  { to: '/account/addresses', label: 'Addresses', icon: MapPin },
  { to: '/account/orders', label: 'Orders', icon: Package },
] as const;

/**
 * Shell for the signed-in customer area.
 *
 * The guard lives in the router's `beforeLoad` so an anonymous visitor never
 * sees a frame of this layout before being redirected.
 */
export function AccountLayout() {
  const { profile, signOut, isEmailVerified } = useAuth();
  const pathname = useRouterState({ select: (state) => state.location.pathname });

  useEffect(() => {
    if (typeof window === 'undefined') return;
    document.title = 'My account · Kaal Vastr';
  }, []);

  return (
    <div className="container-kv py-12 lg:py-16">
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-kv-line pb-6">
        <div>
          <p className="eyebrow">My account</p>
          <h1 className="mt-2 font-display text-3xl tracking-tight text-kv-white">
            {profile?.full_name?.trim() || 'Welcome'}
          </h1>
          <p className="mt-1 text-sm text-kv-muted">{profile?.email}</p>
        </div>
        <Button variant="ghost" size="sm" onClick={() => void signOut()}>
          <LogOut className="h-4 w-4" />
          Sign out
        </Button>
      </div>

      {/* role="status" on the banners: both appear on load and both change
          what the customer can do, so neither should arrive silently. */}
      {!isEmailVerified ? (
        <div
          role="status"
          className="mt-6 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-kv-warning/30 bg-kv-warning/[0.07] px-4 py-3 text-sm text-kv-warning"
        >
          <span>Your email is not verified yet, so you cannot order.</span>
          <Link to="/account/verify" className="underline underline-offset-2">
            Verify now
          </Link>
        </div>
      ) : null}

      {!isSupabaseConfigured ? (
        <div
          role="status"
          className="mt-6 rounded-xl border border-kv-danger/30 bg-kv-danger/[0.08] px-4 py-3 text-sm text-kv-danger"
        >
          Supabase is not configured, so account data cannot be loaded.
        </div>
      ) : null}

      {/* ul/li rather than bare links, so a screen reader reports a list of
          three and the active tab is not colour alone. */}
      <nav className="mt-8" aria-label="Account sections">
        <ul className="flex flex-wrap gap-2">
          {TABS.map((tab) => {
            const active =
              tab.to === '/account' ? pathname === '/account' : pathname.startsWith(tab.to);
            return (
              <li key={tab.to}>
                <Link
                  to={tab.to}
                  aria-current={active ? 'page' : undefined}
                  className={cn(
                    'inline-flex items-center gap-2 rounded-full border px-4 py-2 text-xs uppercase tracking-widest transition-colors',
                    active
                      ? 'border-kv-white/30 bg-kv-surface text-kv-white'
                      : 'border-kv-line text-kv-dim hover:border-kv-lineStrong hover:text-kv-silver',
                  )}
                >
                  <tab.icon className="h-3.5 w-3.5" aria-hidden />
                  {tab.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      <div className="mt-8">
        <ErrorBoundary label="this section" resetKey={pathname}>
          <Outlet />
        </ErrorBoundary>
      </div>
    </div>
  );
}
