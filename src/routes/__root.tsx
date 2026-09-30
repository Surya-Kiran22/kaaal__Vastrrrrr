import { Outlet, createRootRouteWithContext, useLocation, type ErrorComponentProps } from '@tanstack/react-router';
import { motion, useReducedMotion } from 'framer-motion';
import { CartDrawer } from '@/components/cart/cart-drawer';
import { SessionTimeout } from '@/components/auth/session-timeout';
import { SiteFooter } from '@/components/layout/site-footer';
import { SiteHeader } from '@/components/layout/site-header';
import { NotFound } from '@/components/layout/not-found';
import { CartDrawerProvider } from '@/features/cart/cart-drawer-context';
import { CartProvider } from '@/features/cart/cart-context';
import { ErrorState } from '@/components/ui/states';
import { RISE_DISTANCE, routeTransition } from '@/lib/motion';
import type { QueryClient } from '@tanstack/react-query';
import type { authController } from '@/lib/auth-controller';

export interface RouterContext {
  queryClient: QueryClient;
  auth: typeof authController;
}

export const Route = createRootRouteWithContext<RouterContext>()({
  component: RootLayout,
  notFoundComponent: NotFound,
  errorComponent: RootErrorBoundary,
});

function RootLayout() {
  const pathname = useLocation({ select: (location) => location.pathname });

  return (
    <CartProvider>
      <CartDrawerProvider>
        <div className="flex min-h-dvh flex-col bg-kv-bg">
          <a
            href="#main"
            className="sr-only-focusable fixed left-4 top-4 z-[80] rounded-full bg-kv-white px-5 py-2.5 text-sm font-medium text-kv-bg"
          >
            Skip to content
          </a>
          {/*
            The staff and admin consoles are a separate product surface: the
            reference dashboard is a full-bleed dark page with its own sidebar
            and no storefront chrome, and a sticky sidebar cannot live inside the
            site header/footer column. So the console renders on its own.
          */}
          {isConsolePath(pathname) ? (
            // No wrapper <main> here: the console shell and the console login
            // screens each supply their own, so a page never nests two landmarks.
            <Outlet />
          ) : (
            <>
              <SiteHeader />
              <main id="main" className="flex-1">
                <RouteTransition>
                  <Outlet />
                </RouteTransition>
              </main>
              <SiteFooter />
              <CartDrawer />
            </>
          )}
          {/* Mounted once, outside the chrome split, so the idle timer runs on
              both the storefront and the console. */}
          <SessionTimeout />
        </div>
      </CartDrawerProvider>
    </CartProvider>
  );
}

function isConsolePath(pathname: string): boolean {
  return pathname === '/admin' || pathname.startsWith('/admin/') || pathname === '/staff' || pathname.startsWith('/staff/');
}

/**
 * Fades the outgoing route's replacement in on navigation.
 *
 * Keyed on `pathname` rather than the full href on purpose: `/shop` and
 * `/shop?category=tees&sort=price-asc` are the same view, and re-animating on
 * every filter click makes the grid feel like it is reloading. Scrolling
 * position is handled by the router's own `scrollRestoration`.
 *
 * Skipped entirely for reduced motion - a cross-fade is exactly the kind of
 * large-area movement that setting is asking us not to perform.
 */
function RouteTransition({ children }: { children: React.ReactNode }) {
  const reduceMotion = useReducedMotion();
  const pathname = useLocation({ select: (location) => location.pathname });

  if (reduceMotion) {
    return <>{children}</>;
  }

  return (
    <motion.div
      key={pathname}
      initial={{ opacity: 0, y: RISE_DISTANCE }}
      animate={{ opacity: 1, y: 0 }}
      transition={routeTransition}
    >
      {children}
    </motion.div>
  );
}

function RootErrorBoundary({ error, reset }: ErrorComponentProps) {
  return (
    <div className="container-kv flex min-h-[70dvh] items-center justify-center py-20">
      <ErrorState
        title="This page hit an error"
        message={error instanceof Error ? error.message : 'An unexpected error occurred.'}
        onRetry={() => {
          reset();
          window.location.reload();
        }}
      />
    </div>
  );
}
