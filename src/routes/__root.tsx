import { Outlet, createRootRouteWithContext, type ErrorComponentProps } from '@tanstack/react-router';
import { CartDrawer } from '@/components/cart/cart-drawer';
import { SiteFooter } from '@/components/layout/site-footer';
import { SiteHeader } from '@/components/layout/site-header';
import { NotFound } from '@/components/layout/not-found';
import { CartDrawerProvider } from '@/features/cart/cart-drawer-context';
import { CartProvider } from '@/features/cart/cart-context';
import { ErrorState } from '@/components/ui/states';
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
            <Outlet />
          </main>
          <SiteFooter />
          <CartDrawer />
        </div>
      </CartDrawerProvider>
    </CartProvider>
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
