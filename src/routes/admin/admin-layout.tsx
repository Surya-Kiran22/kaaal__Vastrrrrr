import { Link, useNavigate } from '@tanstack/react-router';
import { ClipboardList, LayoutDashboard, Package, Settings2, Users } from 'lucide-react';
import { ConsoleShell, type ConsoleNavItem } from '@/components/console/console-shell';
import { useAuth } from '@/hooks/useAuth';

const ADMIN_NAV: readonly ConsoleNavItem[] = [
  { to: '/admin', label: 'Overview', icon: LayoutDashboard, exact: true },
  { to: '/admin/products', label: 'Products', icon: Package },
  { to: '/admin/inventory', label: 'Inventory', icon: ClipboardList },
  { to: '/admin/accounts', label: 'Staff & accounts', icon: Users },
  { to: '/admin/settings', label: 'Business settings', icon: Settings2 },
];

/**
 * The admin console. All the chrome lives in <ConsoleShell>; this component
 * only decides which sections exist and where sign-out lands.
 */
export function AdminLayout() {
  const { signOut } = useAuth();
  const navigate = useNavigate();

  const handleSignOut = async () => {
    await signOut();
    void navigate({ to: '/admin/login', replace: true });
  };

  return (
    <ConsoleShell
      items={ADMIN_NAV}
      subtitle="Command Centre"
      signOut={() => void handleSignOut()}
      footerLinks={
        <Link
          to="/shop"
          className="flex w-full items-center gap-3 rounded-xl px-4 py-3 text-sm text-kv-muted transition hover:bg-white/5 hover:text-white"
        >
          Storefront
        </Link>
      }
    />
  );
}
