import { Link } from '@tanstack/react-router';
import {
  AlertTriangle,
  Archive,
  ArrowRight,
  Boxes,
  CircleDollarSign,
  Package,
  Sparkles,
  Star,
} from 'lucide-react';
import { useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { ErrorBoundary } from '@/components/ui/error-boundary';
import { ErrorState, ProductGridSkeleton, Skeleton, toErrorMessage } from '@/components/ui/states';
import { useAdminProducts } from '@/hooks/useProducts';
import { formatRelativeDate } from '@/lib/format';
import { Money } from '@/lib/privacy';
import { cn } from '@/lib/utils';

export function AdminOverviewPage() {
  const { data: products = [], isPending, isError, error, refetch } = useAdminProducts();

  const stats = useMemo(() => {
    const live = products.filter((product) => !product.is_archived && product.is_available);
    const archived = products.filter((product) => product.is_archived);
    const soldOut = products.filter(
      (product) => !product.is_archived && product.inStock === false,
    );
    const units = live.reduce((sum, product) => sum + product.totalStock, 0);
    const value = live.reduce((sum, product) => sum + product.price * product.totalStock, 0);
    const lowStock = live.filter((product) => product.totalStock > 0 && product.totalStock <= 5);

    return { live, archived, soldOut, units, value, lowStock };
  }, [products]);

  const recent = useMemo(
    () =>
      [...products]
        .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())
        .slice(0, 5),
    [products],
  );

  /**
   * Product-level totals hide the real problem: a hoodie with six units left can
   * still be sold out in every size the customer actually wants. This expands
   * the `Colour|Size` map so the exact gaps are visible without opening a
   * product. Untracked products are skipped — there is nothing to break down.
   */
  const variantGaps = useMemo(() => {
    const gaps: Array<{
      key: string;
      productId: string;
      productName: string;
      color: string;
      size: string;
      units: number;
    }> = [];

    for (const product of products) {
      if (product.is_archived || !product.variant_stock) continue;

      for (const [key, units] of Object.entries(product.variant_stock)) {
        if (units > 5) continue;
        const [color = '', size = ''] = key.split('|');
        gaps.push({
          key: `${product.id}:${key}`,
          productId: product.id,
          productName: product.name,
          color,
          size,
          units,
        });
      }
    }

    // Sold-out combinations are the urgent end of the list.
    return gaps.sort((a, b) => a.units - b.units).slice(0, 8);
  }, [products]);

  if (isPending) {
    return (
      <div className="space-y-8">
        <Skeleton className="h-9 w-56" />
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }, (_, index) => (
            <Skeleton key={index} className="h-28 w-full rounded-xl" />
          ))}
        </div>
        <ProductGridSkeleton count={4} />
      </div>
    );
  }

  const cards = [
    { label: 'Live products', value: stats.live.length, icon: Package, tone: 'text-kv-white' },
    { label: 'Units in stock', value: stats.units, icon: Boxes, tone: 'text-kv-white' },
    { label: 'Stock value', value: stats.value, icon: CircleDollarSign, tone: 'text-kv-white', money: true },
    { label: 'Archived', value: stats.archived.length, icon: Archive, tone: 'text-kv-muted' },
  ] as const;

  return (
    <div className="space-y-9">
      <header>
        <p className="eyebrow">Overview</p>
        <h1 className="mt-3 font-display text-3xl tracking-tight text-kv-white">Catalogue health</h1>
        <p className="mt-3 max-w-xl text-sm leading-relaxed text-kv-muted">
          Everything you change here appears on the customer storefront immediately. Archived products keep
          their records but are hidden from shoppers.
        </p>
      </header>

      {/*
        Every panel below is a separate failure unit. They all read from the one
        products query, but a throw while expanding the variant map must not
        cost the admin their navigation and page heading, so each region carries
        its own boundary and retry.
      */}
      {isError ? (
        <ErrorState
          title="Could not load products"
          message={toErrorMessage(error)}
          onRetry={() => void refetch()}
        />
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {cards.map((card) => (
              <div key={card.label} className="edge-light rounded-xl border border-kv-line bg-kv-card p-5">
                <div className="flex items-center justify-between">
                  <p className="text-2xs uppercase tracking-widest text-kv-dim">{card.label}</p>
                  <card.icon className="h-4 w-4 text-kv-dim" aria-hidden />
                </div>
                <p className={`mt-3 font-display text-3xl tabular-nums ${card.tone}`}>
                  {'money' in card ? <Money value={card.value} /> : card.value}
                </p>
              </div>
            ))}
          </div>

          {/* Attention needed -------------------------------------------- */}
          <ErrorBoundary label="the stock alerts" onRetry={() => void refetch()}>
            {stats.lowStock.length > 0 || stats.soldOut.length > 0 ? (
        <div className="grid gap-4 md:grid-cols-2">
          {stats.lowStock.length > 0 ? (
            <div className="rounded-xl border border-kv-warning/25 bg-kv-warning/[0.06] p-5">
              <p className="flex items-center gap-2 text-xs uppercase tracking-widest text-kv-warning">
                <AlertTriangle className="h-3.5 w-3.5" aria-hidden />
                Running low ({stats.lowStock.length})
              </p>
              <ul className="mt-4 space-y-2 text-sm">
                {stats.lowStock.slice(0, 5).map((product) => (
                  <li key={product.id} className="flex justify-between gap-3">
                    <Link
                      to="/admin/products/$productId"
                      params={{ productId: product.id }}
                      className="truncate text-kv-silver transition-colors hover:text-kv-white"
                    >
                      {product.name}
                    </Link>
                    <span className="shrink-0 tabular-nums text-kv-warning">
                      {product.totalStock} left
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {stats.soldOut.length > 0 ? (
            <div className="rounded-xl border border-kv-line bg-kv-card p-5">
              <p className="flex items-center gap-2 text-xs uppercase tracking-widest text-kv-muted">
                <Archive className="h-3.5 w-3.5" aria-hidden />
                Sold out ({stats.soldOut.length})
              </p>
              <ul className="mt-4 space-y-2 text-sm">
                {stats.soldOut.slice(0, 5).map((product) => (
                  <li key={product.id}>
                    <Link
                      to="/admin/products/$productId"
                      params={{ productId: product.id }}
                      className="truncate text-kv-silver transition-colors hover:text-kv-white"
                    >
                      {product.name}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}
          </ErrorBoundary>

          {/* Variant-level gaps ------------------------------------------- */}
          <ErrorBoundary label="colour and size availability" onRetry={() => void refetch()}>
            {variantGaps.length > 0 ? (
        <section>
          <h2 className="flex items-center gap-2 font-display text-lg text-kv-white">
            <Boxes className="h-4 w-4 text-kv-dim" aria-hidden />
            Colour &amp; size availability
          </h2>
          <p className="mt-1 text-2xs text-kv-dim">
            Exact combinations at or below five units. Zero means the customer sees that size greyed out.
          </p>
          <ul className="mt-4 divide-y divide-kv-line rounded-2xl border border-kv-line bg-kv-card">
            {variantGaps.map((gap) => (
              <li
                key={gap.key}
                className="flex flex-wrap items-center justify-between gap-3 px-5 py-3"
              >
                <div className="min-w-0">
                  <Link
                    to="/admin/products/$productId"
                    params={{ productId: gap.productId }}
                    className="truncate text-sm text-kv-silver transition-colors hover:text-kv-white"
                  >
                    {gap.productName}
                  </Link>
                  <p className="mt-0.5 text-2xs text-kv-dim">
                    {gap.color}
                    {gap.size ? ` · ${gap.size}` : ''}
                  </p>
                </div>
                <span
                  className={cn(
                    'shrink-0 text-2xs uppercase tracking-widest tabular-nums',
                    gap.units === 0 ? 'text-kv-danger' : 'text-kv-warning',
                  )}
                >
                  {gap.units === 0 ? 'sold out' : `${gap.units} left`}
                </span>
              </li>
            ))}
          </ul>
            </section>
          ) : null}
          </ErrorBoundary>

          {/* Recently updated -------------------------------------------- */}
          <ErrorBoundary label="recently updated products" onRetry={() => void refetch()}>
            <section>
        <div className="mb-5 flex flex-wrap items-center justify-between gap-4">
          <h2 className="font-display text-xl tracking-tight text-kv-white">Recently updated</h2>
          <Button asChild variant="ghost" size="sm">
            <Link to="/admin/products">
              Manage all
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </Button>
        </div>

        {recent.length === 0 ? (
          <div className="rounded-xl border border-dashed border-kv-line px-6 py-14 text-center">
            <p className="text-sm text-kv-muted">No products yet.</p>
            <Button asChild className="mt-6">
              <Link to="/admin/products/new">
                <Sparkles className="h-4 w-4" />
                Add your first product
              </Link>
            </Button>
          </div>
        ) : (
          <ul className="divide-y divide-kv-line rounded-xl border border-kv-line bg-kv-card">
            {recent.map((product) => (
              <li key={product.id}>
                <Link
                  to="/admin/products/$productId"
                  params={{ productId: product.id }}
                  className="flex items-center gap-4 px-5 py-3.5 transition-colors hover:bg-kv-hover"
                >
                  <div className="h-11 w-11 shrink-0 overflow-hidden rounded-lg border border-kv-line bg-kv-raised">
                    {product.primaryImage ? (
                      <img
                        src={product.primaryImage}
                        alt=""
                        loading="lazy"
                        className="h-full w-full object-cover"
                      />
                    ) : null}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm text-kv-white">{product.name}</p>
                    <p className="truncate text-2xs uppercase tracking-wider text-kv-dim">
                      {product.sku} · {product.category}
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="text-sm tabular-nums text-kv-silver">
        <Money value={product.price} />
      </p>
                    <p className="text-2xs text-kv-dim">{formatRelativeDate(product.updated_at)}</p>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
          </ErrorBoundary>
        </>
      )}

      <p className="flex items-center gap-2 text-2xs text-kv-dim">
        <Star className="h-3 w-3" aria-hidden />
        Featured products appear in the home page showcase.
      </p>
    </div>
  );
}
