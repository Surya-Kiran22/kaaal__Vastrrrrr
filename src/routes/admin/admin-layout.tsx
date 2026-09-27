import { Link, Outlet, useNavigate } from '@tanstack/react-router';
import {
  ArrowLeft,
  LayoutDashboard,
  LogOut,
  Package,
  Settings2,
  Users,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/hooks/useAuth';
import { cn } from '@/lib/utils';

const ADMIN_NAV = [
  { to: '/admin', label: 'Overview', icon: LayoutDashboard, exact: true },
  { to: '/admin/products', label: 'Products', icon: Package, exact: false },
  { to: '/admin/accounts', label: 'Staff & accounts', icon: Users, exact: false },
  { to: '/admin/settings', label: 'Business settings', icon: Settings2, exact: false },
] as const;

export function AdminLayout() {
  const { profile, signOut } = useAuth();
  const navigate = useNavigate();

  const handleSignOut = async () => {
    await signOut();
    void navigate({ to: '/admin/login', replace: true });
  };

  return (
    <div className="min-h-[calc(100dvh-6rem)]">
      {/* Admin top bar ------------------------------------------------- */}
      <div className="border-b border-kv-line bg-kv-surface/50">
        <div className="container-kv flex flex-wrap items-center justify-between gap-4 py-4">
          <div className="flex items-center gap-4">
            <Link
              to="/"
              className="flex items-center gap-2 text-2xs uppercase tracking-widest text-kv-dim transition-colors hover:text-kv-silver"
            >
              <ArrowLeft className="h-3 w-3" aria-hidden />
              Storefront
            </Link>
            <span className="hidden h-4 w-px bg-kv-line sm:block" aria-hidden />
            <div>
              <p className="text-sm font-medium text-kv-white">Product management</p>
              <p className="text-2xs text-kv-dim">
                Signed in as {profile?.full_name || profile?.email}
              </p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={handleSignOut}>
            <LogOut className="h-3.5 w-3.5" />
            Sign out
          </Button>
        </div>
      </div>

      <div className="container-kv grid gap-8 py-9 lg:grid-cols-[15rem_1fr] lg:gap-12 lg:py-12">
        {/* Side nav ----------------------------------------------------- */}
        <nav aria-label="Admin sections" className="lg:sticky lg:top-32 lg:self-start">
          <ul className="flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden lg:flex-col lg:overflow-visible lg:pb-0">
            {ADMIN_NAV.map((item) => (
              <li key={item.to} className="shrink-0 lg:shrink">
                <AdminNavLink to={item.to} exact={item.exact} icon={item.icon}>
                  {item.label}
                </AdminNavLink>
              </li>
            ))}
          </ul>
        </nav>

        <div className="min-w-0">
          <Outlet />
        </div>
      </div>
    </div>
  );
}

function AdminNavLink({
  to,
  exact,
  icon: Icon,
  children,
}: {
  to: string;
  exact: boolean;
  icon: typeof LayoutDashboard;
  children: ReactNode;
}) {
  return (
    <Link
      to={to}
      className={cn(
        'flex items-center gap-2.5 whitespace-nowrap rounded-lg px-3.5 py-2.5 text-sm text-kv-muted transition-colors duration-300 hover:bg-kv-hover hover:text-kv-white',
      )}
      activeOptions={{ exact }}
      activeProps={{ className: 'bg-kv-raised text-kv-white' }}
    >
      <Icon className="h-4 w-4 shrink-0" aria-hidden />
      {children}
    </Link>
  );
}
