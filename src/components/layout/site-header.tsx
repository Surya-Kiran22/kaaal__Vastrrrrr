import { Link, useRouterState } from '@tanstack/react-router';
import { AnimatePresence, motion } from 'framer-motion';
import { LayoutDashboard, LogIn, Menu, ShoppingBag, UserRound } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useCart } from '@/features/cart/cart-context';
import { useCartDrawer } from '@/features/cart/cart-drawer-context';
import { useAuth } from '@/hooks/useAuth';
import { useBusinessSettings } from '@/hooks/useProducts';
import { buildWhatsappChatLink } from '@/lib/whatsapp';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Sheet, SheetBody, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';

const NAV_LINKS = [
  { to: '/', label: 'Home', search: undefined },
  { to: '/shop', label: 'Shop', search: undefined },
  { to: '/shop', label: 'Hoodies', search: { category: 'Hoodies' } },
  { to: '/shop', label: 'Tees', search: { category: 'T-Shirts' } },
  { to: '/contact', label: 'Visit Us', search: undefined },
] as const;

export function SiteHeader() {
  const [scrolled, setScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const { totals, canShop } = useCart();
  const { open: openCart } = useCartDrawer();
  const { data: business } = useBusinessSettings();
  const { isAuthenticated, canUseConsole, isAdmin, profile } = useAuth();
  const pathname = useRouterState({ select: (state) => state.location.pathname });

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => {
    setMenuOpen(false);
  }, [pathname]);

  const whatsapp = buildWhatsappChatLink(business?.whatsapp_number);
  const initial = profile?.full_name?.trim()?.charAt(0).toUpperCase();
  const consoleTo = isAdmin ? '/admin' : '/staff';

  return (
    <header
      className={cn(
        'sticky top-0 z-40 border-b transition-all duration-500 ease-premium',
        scrolled
          ? 'border-kv-line bg-kv-bg/85 backdrop-blur-xl supports-[backdrop-filter]:bg-kv-bg/70'
          : 'border-transparent bg-kv-bg',
      )}
    >
      <div className="container-kv flex h-16 items-center justify-between gap-4 lg:h-[4.5rem]">
        <Link
          to="/"
          className="group flex items-center gap-2.5"
          aria-label={`${business?.business_name ?? 'Kaal Vastr'} home`}
        >
          <span className="flex h-9 w-9 items-center justify-center rounded-lg border border-kv-line bg-kv-surface transition-colors duration-300 group-hover:border-kv-lineStrong">
            <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden>
              <path
                d="M5 4v8.2C5 17 7.9 20 12 20s7-3 7-7.8V4"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.2"
                strokeLinecap="round"
              />
              <path d="M2.5 4h5M16.5 4h5" stroke="#8A8A93" strokeWidth="2.2" strokeLinecap="round" />
            </svg>
          </span>
          <span className="flex flex-col leading-none">
            <span className="font-display text-lg tracking-[0.16em] text-kv-white">
              {business?.business_name ?? 'Kaal Vastr'}
            </span>
            <span className="mt-0.5 text-2xs uppercase tracking-widest2 text-kv-dim">Est. 2019</span>
          </span>
        </Link>

        <nav className="hidden items-center gap-1 lg:flex" aria-label="Primary">
          {NAV_LINKS.map((link) => (
            <Link
              key={link.label}
              to={link.to}
              search={link.search}
              className="group relative rounded-full px-4 py-2 text-sm text-kv-silver transition-colors duration-300 hover:text-kv-white"
              activeProps={{ className: 'text-kv-white' }}
            >
              {({ isActive }) => (
                <>
                  {link.label}
                  <span
                    className={cn(
                      'absolute inset-x-4 -bottom-0.5 h-px origin-left bg-kv-white transition-transform duration-300 ease-premium',
                      isActive ? 'scale-x-100' : 'scale-x-0 group-hover:scale-x-100',
                    )}
                  />
                </>
              )}
            </Link>
          ))}
        </nav>

        <div className="flex items-center gap-1.5">
          {/*
            The cart belongs to verified customers only. Staff and admins get a
            console link instead, so neither role ever sees a basket it cannot
            check out.
          */}
          {canUseConsole ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => window.location.assign(consoleTo)}
              className="hidden gap-2 sm:inline-flex"
            >
              <LayoutDashboard className="h-4 w-4" />
              {isAdmin ? 'Admin' : 'Dispatch'}
            </Button>
          ) : null}

          {canShop ? (
            <Button
              variant="ghost"
              size="icon"
              onClick={openCart}
              aria-label={`Open cart, ${totals.itemCount} item${totals.itemCount === 1 ? '' : 's'}`}
              className="relative"
            >
              <ShoppingBag className="h-[1.15rem] w-[1.15rem]" />
              <AnimatePresence>
                {totals.itemCount > 0 ? (
                  <motion.span
                    key="cart-count"
                    initial={{ scale: 0.4, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    exit={{ scale: 0.4, opacity: 0 }}
                    transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
                    className="absolute -right-0.5 -top-0.5 flex h-[1.15rem] min-w-[1.15rem] items-center justify-center rounded-full bg-kv-white px-1 text-2xs font-semibold text-kv-bg"
                  >
                    {totals.itemCount > 99 ? '99+' : totals.itemCount}
                  </motion.span>
                ) : null}
              </AnimatePresence>
            </Button>
          ) : null}

          {isAuthenticated && canShop ? (
            <Button variant="ghost" size="icon" asChild>
              <Link to="/account" aria-label="My account">
                {initial ? (
                  <span className="flex h-6 w-6 items-center justify-center rounded-full border border-kv-line text-2xs font-semibold text-kv-silver">
                    {initial}
                  </span>
                ) : (
                  <UserRound className="h-[1.15rem] w-[1.15rem]" />
                )}
              </Link>
            </Button>
          ) : null}

          {!isAuthenticated ? (
            <Button variant="ghost" size="sm" asChild className="hidden gap-2 sm:inline-flex">
              <Link to="/account/login">
                <LogIn className="h-4 w-4" />
                Sign in
              </Link>
            </Button>
          ) : null}

          <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" className="lg:hidden" aria-label="Open menu">
                <Menu className="h-5 w-5" />
              </Button>
            </SheetTrigger>
            <SheetContent side="right" hideClose className="w-[min(20rem,88vw)] max-w-none">
              <SheetHeader>
                <SheetTitle>Menu</SheetTitle>
              </SheetHeader>
              <SheetBody className="flex flex-col gap-1 p-4">
                {NAV_LINKS.map((link) => (
                  <Link
                    key={link.label}
                    to={link.to}
                    search={link.search}
                    onClick={() => setMenuOpen(false)}
                    className="rounded-lg px-4 py-3 text-sm text-kv-silver transition-colors hover:bg-kv-hover hover:text-kv-white"
                    activeProps={{ className: 'bg-kv-hover text-kv-white' }}
                  >
                    {link.label}
                  </Link>
                ))}
                <div className="rule-silver my-3" />
                {whatsapp ? (
                  <a
                    href={whatsapp}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center justify-center gap-2 rounded-full bg-[#25D366] px-5 py-3 text-sm font-medium text-[#052E16]"
                  >
                    <MessageCircleIcon />
                    Chat on WhatsApp
                  </a>
                ) : null}
                {canShop ? (
                  <Link
                    to="/account"
                    onClick={() => setMenuOpen(false)}
                    className="mt-1 flex items-center justify-center gap-2 rounded-full border border-kv-line px-5 py-3 text-xs uppercase tracking-widest text-kv-dim transition-colors hover:border-kv-lineStrong hover:text-kv-silver"
                  >
                    <UserRound className="h-3 w-3" aria-hidden />
                    My Account
                  </Link>
                ) : null}

                {isAuthenticated ? (
                  <AccountActions onNavigate={() => setMenuOpen(false)} />
                ) : (
                  <div className="mt-1 grid grid-cols-2 gap-2">
                    <Link
                      to="/account/login"
                      onClick={() => setMenuOpen(false)}
                      className="flex items-center justify-center gap-2 rounded-full border border-kv-line px-4 py-3 text-xs uppercase tracking-widest text-kv-dim transition-colors hover:border-kv-lineStrong hover:text-kv-silver"
                    >
                      <LogIn className="h-3 w-3" aria-hidden />
                      Sign in
                    </Link>
                    <Link
                      to="/account/register"
                      onClick={() => setMenuOpen(false)}
                      className="flex items-center justify-center gap-2 rounded-full bg-kv-white px-4 py-3 text-xs uppercase tracking-widest text-kv-bg"
                    >
                      Register
                    </Link>
                  </div>
                )}

                {canUseConsole ? (
                  <Link
                    to={consoleTo}
                    onClick={() => setMenuOpen(false)}
                    className="flex items-center justify-center gap-2 rounded-full border border-kv-line px-5 py-3 text-xs uppercase tracking-widest text-kv-dim transition-colors hover:border-kv-lineStrong hover:text-kv-silver"
                  >
                    <LayoutDashboard className="h-3 w-3" aria-hidden />
                    {isAdmin ? 'Admin Dashboard' : 'Dispatch Console'}
                  </Link>
                ) : null}
              </SheetBody>
            </SheetContent>
          </Sheet>
        </div>
      </div>
    </header>
  );
}

/** Sign-out, plus an orders shortcut for signed-in staff who have no cart. */
function AccountActions({ onNavigate }: { onNavigate: () => void }) {
  const { signOut } = useAuth();

  return (
    <>
      <Link
        to="/account/orders"
        onClick={onNavigate}
        className="flex items-center justify-center gap-2 rounded-full border border-kv-line px-5 py-3 text-xs uppercase tracking-widest text-kv-dim transition-colors hover:border-kv-lineStrong hover:text-kv-silver"
      >
        <ShoppingBag className="h-3 w-3" aria-hidden />
        My Orders
      </Link>
      <button
        type="button"
        onClick={() => {
          onNavigate();
          void signOut();
        }}
        className="flex items-center justify-center gap-2 rounded-full border border-kv-line px-5 py-3 text-xs uppercase tracking-widest text-kv-dim transition-colors hover:border-kv-lineStrong hover:text-kv-silver"
      >
        Sign out
      </button>
    </>
  );
}

function MessageCircleIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor" aria-hidden>
      <path d="M12.04 2C6.6 2 2.2 6.4 2.2 11.84c0 1.94.56 3.75 1.53 5.31L2 22l4.98-1.68a9.8 9.8 0 0 0 5.06 1.39h.01c5.43 0 9.84-4.4 9.84-9.84C21.89 6.4 17.48 2 12.04 2Zm5.75 13.9c-.24.68-1.4 1.3-1.94 1.35-.54.05-1.02.24-3.45-.72-2.9-1.15-4.73-4.13-4.87-4.32-.14-.19-1.16-1.55-1.16-2.95s.73-2.09.99-2.38c.26-.29.57-.36.76-.36.19 0 .38 0 .55.01.19.01.44-.07.68.52.24.58.82 2 .89 2.15.07.14.12.31.02.5-.1.19-.14.31-.29.48-.14.16-.3.36-.43.49-.14.14-.29.29-.12.57.17.29.74 1.22 1.59 1.98 1.09.97 2.01 1.27 2.3 1.41.29.14.46.12.63-.07.17-.19.72-.84.91-1.13.19-.29.38-.24.64-.14.26.09 1.65.78 1.93.92.29.14.48.22.55.34.07.12.07.68-.17 1.36Z" />
    </svg>
  );
}
