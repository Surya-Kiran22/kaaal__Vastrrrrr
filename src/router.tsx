import { createRoute, createRouter, redirect } from '@tanstack/react-router';
import { Route as rootRoute } from './routes/__root';
import { AccountAddressesPage } from './routes/account/account-addresses-page';
import { AccountLayout } from './routes/account/account-layout';
import { AccountLoginPage, type AccountLoginSearch } from './routes/account/account-login-page';
import { AccountOrdersPage } from './routes/account/account-orders-page';
import { AccountPage } from './routes/account/account-page';
import {
  AccountRegisterPage,
  type AccountRegisterSearch,
} from './routes/account/account-register-page';
import { AccountVerifyPage, type AccountVerifySearch } from './routes/account/account-verify-page';
import { AdminAccountsPage } from './routes/admin/admin-accounts-page';
import { AdminLayout } from './routes/admin/admin-layout';
import { AdminLoginPage, type AdminLoginSearch } from './routes/admin/admin-login-page';
import { AdminOverviewPage } from './routes/admin/admin-overview-page';
import { AdminInventoryPage } from './routes/admin/admin-inventory-page';
import {
  AdminProductEditPage,
  AdminProductNewPage,
} from './routes/admin/admin-product-form-page';
import { AdminProductsPage } from './routes/admin/admin-products-page';
import { AdminSettingsPage } from './routes/admin/admin-settings-page';
import { ContactPage } from './routes/contact-page';
import { HomePage } from './routes/home-page';
import { InvoiceTokenPage } from './routes/invoice-token-page';
import { ProductDetailPage } from './routes/product-detail-page';
import { ShopPage, type ShopSearch } from './routes/shop-page';
import { StaffLayout } from './routes/staff/staff-layout';
import { type StaffLoginSearch } from './routes/staff/staff-login-page';
import { StaffOrdersPage } from './routes/staff/staff-orders-page';
import { authController } from '@/lib/auth-controller';
import { queryClient } from '@/lib/query-client';
import type { ProductSort } from '@/hooks/useProducts';

const SORTS: readonly ProductSort[] = ['newest', 'price-asc', 'price-desc', 'name-asc'];

const isProductSort = (value: unknown): value is ProductSort =>
  typeof value === 'string' && (SORTS as readonly string[]).includes(value);

/* -------------------------------------------------------------------------- */
/* Storefront                                                                  */
/* -------------------------------------------------------------------------- */

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: HomePage,
});

const shopRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/shop',
  validateSearch: (search: Record<string, unknown>): ShopSearch => ({
    category: typeof search.category === 'string' ? search.category : undefined,
    q: typeof search.q === 'string' ? search.q : undefined,
    sort: isProductSort(search.sort) ? search.sort : undefined,
  }),
  component: ShopPage,
});

const productRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/product/$slug',
  component: ProductDetailPage,
});

const contactRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/contact',
  component: ContactPage,
});

/* Public shareable invoice. No guard: the token in RPC lookup is the auth. */
const invoiceRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/invoice/$token',
  component: InvoiceTokenPage,
});

/* -------------------------------------------------------------------------- */
/* Customer account                                                            */
/* -------------------------------------------------------------------------- */

const accountLoginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/account/login',
  validateSearch: (search: Record<string, unknown>): AccountLoginSearch => ({
    redirect: typeof search.redirect === 'string' ? search.redirect : undefined,
  }),
  component: AccountLoginPage,
});

const accountRegisterRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/account/register',
  validateSearch: (search: Record<string, unknown>): AccountRegisterSearch => ({
    redirect: typeof search.redirect === 'string' ? search.redirect : undefined,
  }),
  component: AccountRegisterPage,
});

const accountVerifyRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/account/verify',
  validateSearch: (search: Record<string, unknown>): AccountVerifySearch => ({
    email: typeof search.email === 'string' ? search.email : undefined,
    justSignedUp: search.justSignedUp === '1' ? '1' : undefined,
  }),
  component: AccountVerifyPage,
});

/**
 * Guard for the signed-in customer area.
 *
 * Anyone signed in may reach the shell so that an unverified customer can read
 * the "verify your email" notice, but the pages themselves are for customers
 * only: staff have no cart, no saved addresses and no order history.
 */
async function requireCustomer(context: { auth: typeof authController }, location: { href: string }) {
  const { status, profile } = await context.auth.ready();

  if (status === 'unconfigured') {
    throw redirect({ to: '/account/login', search: { redirect: location.href } });
  }
  if (status !== 'authenticated') {
    throw redirect({ to: '/account/login', search: { redirect: location.href } });
  }
  if (profile?.role !== 'customer') {
    // Staff and admins have their own consoles.
    throw redirect({ to: profile?.role === 'admin' ? '/admin' : '/staff' });
  }
}

const accountRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/account',
  beforeLoad: ({ context, location }) => requireCustomer(context, location),
  component: AccountLayout,
});

const accountIndexRoute = createRoute({
  getParentRoute: () => accountRoute,
  path: '/',
  component: AccountPage,
});

const accountAddressesRoute = createRoute({
  getParentRoute: () => accountRoute,
  path: '/addresses',
  component: AccountAddressesPage,
});

const accountOrdersRoute = createRoute({
  getParentRoute: () => accountRoute,
  path: '/orders',
  component: AccountOrdersPage,
});

/* -------------------------------------------------------------------------- */
/* Staff dispatch console                                                      */
/* -------------------------------------------------------------------------- */

/*
 * There is deliberately only one console sign-in door.
 *
 * `/admin/login` takes both staff and admin, so a single known-good URL survives
 * any breakage on the customer side. This route is kept only to redirect the
 * old bookmark, and it preserves the requested destination so `/staff/login`
 * still lands a staff member on the dispatch console.
 */
const staffLoginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/staff/login',
  validateSearch: (search: Record<string, unknown>): StaffLoginSearch => ({
    redirect: typeof search.redirect === 'string' ? search.redirect : undefined,
    reason: search.reason === 'forbidden' ? 'forbidden' : undefined,
  }),
  beforeLoad: ({ search }) => {
    throw redirect({
      to: '/admin/login',
      search: { redirect: search.redirect ?? '/staff', reason: search.reason },
    });
  },
  component: () => null,
});

/**
 * Admins are allowed in so they can *see* the dispatch log, which the brief
 * asks for. They cannot change anything: the controls are hidden here and
 * `set_order_status` independently rejects the role.
 */
async function requireConsole(context: { auth: typeof authController }, location: { href: string }) {
  const { status, profile } = await context.auth.ready();

  if (status !== 'authenticated') {
    throw redirect({ to: '/staff/login', search: { redirect: location.href } });
  }
  if (profile?.role !== 'staff' && profile?.role !== 'admin') {
    throw redirect({ to: '/staff/login', search: { reason: 'forbidden' } });
  }
  if (!profile.is_active || profile.status !== 'active') {
    throw redirect({ to: '/staff/login', search: { reason: 'forbidden' } });
  }
}

const staffRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/staff',
  beforeLoad: ({ context, location }) => requireConsole(context, location),
  component: StaffLayout,
});

const staffOrdersRoute = createRoute({
  getParentRoute: () => staffRoute,
  path: '/',
  component: StaffOrdersPage,
});

/* -------------------------------------------------------------------------- */
/* Admin                                                                       */
/* -------------------------------------------------------------------------- */

const adminLoginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/admin/login',
  validateSearch: (search: Record<string, unknown>): AdminLoginSearch => ({
    redirect: typeof search.redirect === 'string' ? search.redirect : undefined,
    reason: search.reason === 'forbidden' ? 'forbidden' : undefined,
  }),
  component: AdminLoginPage,
});

const adminRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/admin',
  /**
   * Runs before any admin component renders. Because the auth controller is a
   * plain module singleton, this can await a real session without a render race.
   */
  beforeLoad: async ({ context, location }) => {
    const { status, profile } = await context.auth.ready();

    if (status === 'unconfigured') {
      throw redirect({ to: '/admin/login', search: { redirect: location.href } });
    }
    if (status !== 'authenticated') {
      throw redirect({ to: '/admin/login', search: { redirect: location.href } });
    }
    if (profile?.role !== 'admin' || !profile.is_active) {
      throw redirect({ to: '/admin/login', search: { redirect: location.href, reason: 'forbidden' } });
    }
  },
  component: AdminLayout,
});

const adminIndexRoute = createRoute({
  getParentRoute: () => adminRoute,
  path: '/',
  component: AdminOverviewPage,
});

const adminProductsRoute = createRoute({
  getParentRoute: () => adminRoute,
  path: '/products',
  component: AdminProductsPage,
});

const adminProductNewRoute = createRoute({
  getParentRoute: () => adminRoute,
  path: '/products/new',
  component: AdminProductNewPage,
});

const adminProductEditRoute = createRoute({
  getParentRoute: () => adminRoute,
  path: '/products/$productId',
  component: AdminProductEditPage,
});

const adminAccountsRoute = createRoute({
  getParentRoute: () => adminRoute,
  path: '/accounts',
  component: AdminAccountsPage,
});

const adminInventoryRoute = createRoute({
  getParentRoute: () => adminRoute,
  path: '/inventory',
  component: AdminInventoryPage,
});

const adminSettingsRoute = createRoute({
  getParentRoute: () => adminRoute,
  path: '/settings',
  component: AdminSettingsPage,
});

const routeTree = rootRoute.addChildren([
  indexRoute,
  shopRoute,
  productRoute,
  contactRoute,
  invoiceRoute,
  accountLoginRoute,
  accountRegisterRoute,
  accountVerifyRoute,
  accountRoute.addChildren([accountIndexRoute, accountAddressesRoute, accountOrdersRoute]),
  staffLoginRoute,
  staffRoute.addChildren([staffOrdersRoute]),
  adminLoginRoute,
  adminRoute.addChildren([
    adminIndexRoute,
    adminProductsRoute,
    adminProductNewRoute,
    adminProductEditRoute,
    adminAccountsRoute,
    adminInventoryRoute,
    adminSettingsRoute,
  ]),
]);

export const router = createRouter({
  routeTree,
  context: { queryClient, auth: authController },
  defaultPreload: 'intent',
  defaultPreloadStaleTime: 30_000,
  scrollRestoration: true,
  defaultNotFoundComponent: rootRoute.options.notFoundComponent,
});

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
