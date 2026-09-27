import { Link, Outlet, useRouterState } from '@tanstack/react-router';
import { ExternalLink, LogOut } from 'lucide-react';
import { ErrorBoundary } from '@/components/ui/error-boundary';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/hooks/useAuth';

export function StaffLayout() {
  const { profile, signOut, isAdmin } = useAuth();
  const pathname = useRouterState({ select: (state) => state.location.pathname });

  return (
    <div className="container-kv py-12 lg:py-16">
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-kv-line pb-6">
        <div>
          <p className="eyebrow">Dispatch console</p>
          <h1 className="mt-2 font-display text-3xl tracking-tight text-kv-white">
            {isAdmin ? 'Dispatch log' : 'Orders to fulfil'}
          </h1>
          <p className="mt-1 text-sm text-kv-muted">
            Signed in as {profile?.full_name?.trim() || profile?.email}
            {isAdmin ? ' · admin, read-only here' : ''}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button variant="ghost" size="sm" asChild>
            <Link to="/shop">
              <ExternalLink className="h-4 w-4" />
              View store
            </Link>
          </Button>
          {isAdmin ? (
            <Button variant="ghost" size="sm" asChild>
              <Link to="/admin">Admin dashboard</Link>
            </Button>
          ) : null}
          <Button variant="ghost" size="sm" onClick={() => void signOut()}>
            <LogOut className="h-4 w-4" />
            Sign out
          </Button>
        </div>
      </div>

      {isAdmin ? (
        <p className="mt-6 rounded-xl border border-kv-line bg-kv-surface/40 px-4 py-3 text-xs text-kv-muted">
          You are signed in as an admin, so this log is read-only. Dispatch status changes belong to staff
          accounts, and the database rejects admin attempts as well.
        </p>
      ) : null}

      <div className="mt-8">
        <ErrorBoundary label="the dispatch log" resetKey={pathname}>
          <Outlet />
        </ErrorBoundary>
      </div>
    </div>
  );
}
