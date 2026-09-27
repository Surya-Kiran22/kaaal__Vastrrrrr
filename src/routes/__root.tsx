import { Outlet, createRootRouteWithContext, useLocation, type ErrorComponentProps } from '@tanstack/react-router';
import { motion, useReducedMotion } from 'framer-motion';
import { CartDrawer } from '@/components/cart/cart-drawer';
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
          <SiteHeader />
          <main id="main" className="flex-1">
            <RouteTransition>
              <Outlet />
            </RouteTransition>
          </main>
          <SiteFooter />
          <CartDrawer />
        </div>
      </CartDrawerProvider>
    </CartProvider>
  );
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
