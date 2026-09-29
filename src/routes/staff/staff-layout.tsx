import { Link, useRouterState } from '@tanstack/react-router';
import { LayoutDashboard, ListChecks } from 'lucide-react';
import { ErrorBoundary } from '@/components/ui/error-boundary';
import { ConsoleShell, type ConsoleNavItem } from '@/components/console/console-shell';
import { useAuth } from '@/hooks/useAuth';

/**
 * The staff dispatch console. Uses the same flat shell as the admin console, so
 * both read as one product; the sections differ because the jobs differ.
 */
export function StaffLayout() {
  const { isAdmin, signOut } = useAuth();
  const pathname = useRouterState({ select: (state) => state.location.pathname });

  const items: readonly ConsoleNavItem[] = isAdmin
    ? [
        { to: '/staff', label: 'Dispatch log', icon: ListChecks, exact: true },
        { to: '/admin', label: 'Admin dashboard', icon: LayoutDashboard },
      ]
    : [{ to: '/staff', label: 'Dispatch log', icon: ListChecks, exact: true }];

  return (
    <ConsoleShell
      items={items}
      subtitle="Dispatch"
      signOut={() => void signOut()}
      footerLinks={
        <Link
          to="/shop"
          className="flex w-full items-center gap-3 rounded-xl px-4 py-3 text-sm text-kv-muted transition hover:bg-white/5 hover:text-white"
        >
          View store
        </Link>
      }
      banner={
        isAdmin ? (
          <p className="rounded-xl border border-kv-line bg-kv-card px-4 py-3 text-sm text-kv-muted">
            You are signed in as an admin, so this log is read-only. Dispatch status changes belong to staff
            accounts, and the database rejects admin attempts as well.
          </p>
        ) : null
      }
      wrap={(children) => (
        <ErrorBoundary label="the dispatch log" resetKey={pathname}>
          {children}
        </ErrorBoundary>
      )}
    />
  );
}
