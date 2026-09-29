import { Link, Outlet, useNavigate, useRouterState } from '@tanstack/react-router';
import { LogOut, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { PrivacyToggle } from '@/components/console/privacy-toggle';
import { cn } from '@/lib/utils';

export interface ConsoleNavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  /** Only `/admin` itself counts as active, not every `/admin/...` path. */
  exact?: boolean;
}

interface ConsoleShellProps {
  items: readonly ConsoleNavItem[];
  /** Line under the wordmark, e.g. "Command Centre". */
  subtitle: string;
  /** Shown in the mobile bar next to the mark. */
  signOut: () => void;
  /** Extra links rendered above sign out, e.g. "View store". */
  footerLinks?: ReactNode;
  /** Rendered inside the page column, below the nav, on mobile only. */
  banner?: ReactNode;
  /** Wraps the routed page, e.g. in an error boundary. */
  wrap?: (children: ReactNode) => ReactNode;
}

/**
 * The console shell from the reference dashboard: a fixed flat aside on the
 * left, a compact bar on small screens, and a centred page column.
 *
 * Only presentation lives here. Routes, guards, queries and permissions are
 * untouched - each layout still owns its own `beforeLoad` and auth handling.
 */
export function ConsoleShell({
  items,
  subtitle,
  signOut,
  footerLinks,
  banner,
  wrap,
}: ConsoleShellProps) {
  const navigate = useNavigate();
  // Derive the highlighted section from the URL rather than local state, so a
  // direct load or a deep link (e.g. /staff/orders/invoice) still labels the bar
  // correctly.
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const current =
    items.find((item) => item.to === pathname) ??
    items.find((item) => pathname.startsWith(`${item.to}/`)) ??
    items[0];

  return (
    <div data-console className="flex min-h-dvh bg-kv-bg">
      {/* Sidebar -------------------------------------------------------- */}
      <aside className="glass sticky top-0 hidden h-dvh w-64 shrink-0 flex-col justify-between rounded-none border-r border-kv-line-strong p-6 lg:flex">
        <div>
          <div className="mb-10 flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-full border border-kv-line-strong bg-kv-raised">
              <span className="gold-text font-display text-lg tracking-widest">KV</span>
            </div>
            <div>
              <p className="font-display text-lg">Kaal Vastr</p>
              <p className="text-[10px] uppercase tracking-[0.3em] text-kv-muted">{subtitle}</p>
            </div>
          </div>

          <nav className="space-y-1">
            {items.map((item) => (
              <Link
                key={item.to}
                to={item.to}
                activeOptions={{ exact: item.exact ?? false }}
                className="group relative flex w-full items-center gap-3 rounded-xl px-4 py-3 text-sm text-kv-muted transition-all hover:bg-white/5 hover:text-white"
                activeProps={{ className: 'bg-kv-raised/60 text-kv-white' }}
              >
                {({ isActive }) => (
                  <>
                    {isActive ? (
                      <span
                        aria-hidden
                        className="absolute left-0 top-1/2 h-6 w-[2px] -translate-y-1/2 rounded-full bg-kv-white"
                      />
                    ) : null}
                    <item.icon className="h-4 w-4" aria-hidden />
                    <span className="tracking-wide">{item.label}</span>
                  </>
                )}
              </Link>
            ))}
          </nav>
        </div>

        <div className="space-y-1">
          <PrivacyToggle variant="nav" />
          {footerLinks}
          <button
            type="button"
            onClick={signOut}
            className="flex w-full items-center gap-3 rounded-xl px-4 py-3 text-sm text-kv-muted transition hover:bg-white/5 hover:text-white"
          >
            <LogOut className="h-4 w-4" aria-hidden />
            Sign out
          </button>
        </div>
      </aside>

      {/* Small-screen bar ----------------------------------------------- */}
      <div className="glass fixed inset-x-0 top-0 z-30 flex items-center justify-between border-b border-kv-line-strong p-4 lg:hidden">
        <div className="flex items-center gap-2">
          <span className="gold-text font-display text-lg tracking-widest">KV</span>
          <span className="text-xs uppercase tracking-widest text-kv-muted">
            {current?.label}
          </span>
        </div>
        <select
          aria-label="Console section"
          value={current?.to ?? ''}
          onChange={(event) => {
            const target = items.find((item) => item.to === event.target.value);
            if (!target) return;
            void navigate({ to: target.to });
          }}
          className="rounded-lg border border-kv-line-strong bg-kv-raised px-3 py-1 text-sm text-kv-white"
        >
          {items.map((item) => (
            <option key={item.to} value={item.to}>
              {item.label}
            </option>
          ))}
        </select>
      </div>

      {/* Page column ----------------------------------------------------- */}
      <main id="main" className="mx-auto w-full max-w-7xl flex-1 space-y-8 px-5 pt-24 pb-16 sm:px-8 lg:px-10 lg:pt-10">
        {banner}
        <div className={cn('min-w-0')}>
          {wrap ? wrap(<Outlet />) : <Outlet />}
        </div>
      </main>
    </div>
  );
}
