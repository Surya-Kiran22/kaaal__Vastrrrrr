import { useMemo, useState } from 'react';
import {
  AlertTriangle,
  Boxes,
  CircleDollarSign,
  Package,
  PackageX,
  Search,
  Box,
} from 'lucide-react';
import { ErrorState, Skeleton, toErrorMessage } from '@/components/ui/states';
import { useAdminProducts } from '@/hooks/useProducts';
import { Money } from '@/lib/privacy';
import { cn } from '@/lib/utils';
import type { StoreProduct } from '@/types';

const LOW_STOCK_THRESHOLD = 5;

type StatusFilter = 'all' | 'available' | 'low' | 'out' | 'archived';

function unitsOf(product: StoreProduct): { key: string; colour: string; size: string; units: number }[] {
  const entries = Object.entries(product.variant_stock ?? {});
  return entries
    .map(([key, units]) => {
      const [colour = '', size = ''] = key.split('|');
      return { key, colour, size, units };
    })
    .sort((a, b) => a.key.localeCompare(b.key));
}

function chipTone(units: number): string {
  if (units === 0) return 'border-kv-line bg-kv-muted/10 text-kv-dim';
  if (units <= LOW_STOCK_THRESHOLD)
    return 'border-kv-warning/30 bg-kv-warning/[0.08] text-kv-warning';
  return 'border-kv-line bg-kv-card text-kv-white';
}

function StatusPill({ product }: { product: StoreProduct }) {
  if (product.is_archived) {
    return (
      <span className="inline-flex items-center rounded-md bg-kv-muted/15 px-2 py-0.5 text-2xs uppercase tracking-widest text-kv-muted">
        Archived
      </span>
    );
  }
  if (!product.is_available) {
    return (
      <span className="inline-flex items-center rounded-md bg-kv-muted/15 px-2 py-0.5 text-2xs uppercase tracking-widest text-kv-muted">
        Unavailable
      </span>
    );
  }
  if (product.totalStock === 0) {
    return (
      <span className="inline-flex items-center gap-1 rounded-md bg-kv-danger/15 px-2 py-0.5 text-2xs uppercase tracking-widest text-kv-danger">
        <PackageX className="h-3 w-3" aria-hidden />
        Out
      </span>
    );
  }
  if (product.totalStock <= LOW_STOCK_THRESHOLD) {
    return (
      <span className="inline-flex items-center gap-1 rounded-md bg-kv-warning/15 px-2 py-0.5 text-2xs uppercase tracking-widest text-kv-warning">
        <AlertTriangle className="h-3 w-3" aria-hidden />
        Low
      </span>
    );
  }
  return (
    <span className="inline-flex items-center rounded-md bg-kv-success/15 px-2 py-0.5 text-2xs uppercase tracking-widest text-kv-success">
      In stock
    </span>
  );
}

const STATUS_OPTIONS: { value: StatusFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'available', label: 'Available' },
  { value: 'low', label: 'Low' },
  { value: 'out', label: 'Out' },
  { value: 'archived', label: 'Archived' },
];

export function InventorySection() {
  const { data: products = [], isPending, isError, error, refetch } = useAdminProducts();

  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('all');
  const [status, setStatus] = useState<StatusFilter>('all');

  const available = useMemo(
    () => products.filter((product) => !product.is_archived && product.is_available),
    [products],
  );

  const stats = useMemo(() => {
    const out = available.filter((product) => product.totalStock === 0).length;
    const low = available.filter(
      (product) => product.totalStock > 0 && product.totalStock <= LOW_STOCK_THRESHOLD,
    ).length;
    const units = available.reduce((sum, product) => sum + product.totalStock, 0);
    const value = available.reduce((sum, product) => sum + product.price * product.totalStock, 0);
    return { live: available.length, out, low, units, value };
  }, [available]);

  const categories = useMemo(
    () => [...new Set(products.map((product) => product.category).filter(Boolean))].sort(),
    [products],
  );

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return [...products]
      .filter((product) => {
        if (category !== 'all' && product.category !== category) return false;
        if (term) {
          const haystack = [product.name, product.category, product.sku, product.brand]
            .filter(Boolean)
            .join(' ')
            .toLowerCase();
          if (!haystack.includes(term)) return false;
        }
        switch (status) {
          case 'available':
            return !product.is_archived && product.is_available && product.totalStock > 0;
          case 'low':
            return (
              !product.is_archived &&
              product.is_available &&
              product.totalStock > 0 &&
              product.totalStock <= LOW_STOCK_THRESHOLD
            );
          case 'out':
            return !product.is_archived && product.is_available && product.totalStock === 0;
          case 'archived':
            return product.is_archived;
          default:
            return true;
        }
      })
      .sort((a, b) => b.totalStock - a.totalStock || a.name.localeCompare(b.name));
  }, [products, search, category, status]);

  const statCards = [
    { label: 'Live products', value: String(stats.live), icon: Package, tone: 'text-kv-white' },
    { label: 'Units in stock', value: String(stats.units), icon: Boxes, tone: 'text-kv-white' },
    { label: 'Stock value', value: stats.value, icon: CircleDollarSign, tone: 'text-kv-white', money: true },
    { label: 'Low stock', value: String(stats.low), icon: AlertTriangle, tone: 'text-kv-warning' },
    { label: 'Out of stock', value: String(stats.out), icon: PackageX, tone: stats.out ? 'text-kv-danger' : 'text-kv-white' },
  ] as const;

  return (
    <div className="space-y-9">
      <header>
        <p className="eyebrow">Inventory</p>
        <h1 className="mt-3 text-3xl tracking-tight text-kv-white">Stock by variant</h1>
        <p className="mt-3 max-w-xl text-sm leading-relaxed text-kv-muted">
          Every tracked Colour|Size combination, the same live data the storefront
          sells from. Zero units anywhere means that size is not orderable.
        </p>
      </header>

      {isError ? (
        <ErrorState
          title="Could not load products"
          message={toErrorMessage(error)}
          onRetry={() => void refetch()}
        />
      ) : isPending ? (
        <div className="space-y-3">
          {[0, 1, 2, 3, 4].map((index) => (
            <Skeleton key={index} className="h-20 w-full" />
          ))}
        </div>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
            {statCards.map((card) => (
              <div key={card.label} className="rounded-xl border border-kv-line bg-kv-card p-5">
                <div className="flex items-start justify-between">
                  <p className="text-2xs uppercase tracking-widest text-kv-dim">{card.label}</p>
                  <card.icon className="h-4 w-4 text-kv-dim" aria-hidden />
                </div>
                <p className={cn('mt-3 font-money text-2xl font-semibold tabular-nums', card.tone)}>
                  {'money' in card ? <Money value={card.value} /> : card.value}
                </p>
              </div>
            ))}
          </div>

          {/* Controls ------------------------------------------------------ */}
          <div className="flex flex-wrap items-center gap-3">
            <label className="relative min-w-[16rem] flex-1 sm:max-w-xs">
              <span className="sr-only">Search products</span>
              <Search
                className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-kv-dim"
                aria-hidden
              />
              <input
                type="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search name, SKU, brand…"
                className="w-full rounded-lg border border-kv-line bg-kv-card py-2 pl-9 pr-3 text-sm text-kv-white outline-none transition-colors placeholder:text-kv-dim focus:border-kv-white/40"
              />
            </label>

            <label className="sr-only" htmlFor="inventory-category">
              Category
            </label>
            <select
              id="inventory-category"
              value={category}
              onChange={(event) => setCategory(event.target.value)}
              className="rounded-lg border border-kv-line bg-kv-card px-3 py-2 text-sm text-kv-white outline-none transition-colors focus:border-kv-white/40"
            >
              <option value="all">All categories</option>
              {categories.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>

            <div role="group" aria-label="Filter by stock status" className="flex flex-wrap gap-1.5">
              {STATUS_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setStatus(option.value)}
                  aria-pressed={status === option.value}
                  className={cn(
                    'rounded-md border border-kv-line px-3 py-1.5 text-2xs uppercase tracking-widest text-kv-muted transition-colors hover:text-kv-white',
                    status === option.value && 'border-kv-white/50 bg-kv-card text-kv-white',
                  )}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>

          {/* Product table ------------------------------------------------- */}
          {filtered.length === 0 ? (
            <div className="flex flex-col items-center rounded-xl border border-dashed border-kv-line bg-kv-card/40 px-6 py-14 text-center">
              <Box className="h-8 w-8 text-kv-dim" aria-hidden />
              <p className="mt-3 text-sm text-kv-white">No products match those filters</p>
              <p className="mt-1 text-2xs text-kv-muted">Try clearing the search or choosing another category.</p>
            </div>
          ) : (
            <div className="overflow-hidden rounded-xl border border-kv-line">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-kv-line text-left text-2xs uppercase tracking-widest text-kv-dim">
                    <th className="px-4 py-3 font-medium sm:px-5">Product</th>
                    <th className="hidden px-3 py-3 font-medium md:table-cell">Variants</th>
                    <th className="px-3 py-3 text-right font-medium">Units</th>
                    <th className="px-3 py-3 text-center font-medium">Status</th>
                    <th className="px-4 py-3 text-right font-medium sm:px-5">Value</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((product) => {
                    const variants = unitsOf(product);
                    const shown = variants.slice(0, 8);
                    const hidden = variants.length - shown.length;
                    return (
                      <tr key={product.id} className="border-b border-kv-line/60 last:border-0">
                        <td className="px-4 py-3 sm:px-5">
                          <p className="font-medium text-kv-white">{product.name}</p>
                          <p className="mt-0.5 text-2xs text-kv-muted">
                            {product.category}
                            {product.sku ? ` · ${product.sku}` : ''}
                          </p>
                        </td>
                        <td className="hidden px-3 py-3 md:table-cell">
                          {variants.length === 0 ? (
                            <span className="text-2xs text-kv-dim">Untracked</span>
                          ) : (
                            <div className="flex max-w-[24rem] flex-wrap gap-1.5">
                              {shown.map((variant) => (
                                <span
                                  key={variant.key}
                                  title={`${variant.colour} / ${variant.size}: ${variant.units}`}
                                  className={cn(
                                    'inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-2xs tabular-nums',
                                    chipTone(variant.units),
                                  )}
                                >
                                  {variant.size || '—'}
                                  <span className="opacity-70">×{variant.units}</span>
                                </span>
                              ))}
                              {hidden > 0 ? (
                                <span className="inline-flex items-center rounded border border-dashed border-kv-line px-1.5 py-0.5 text-2xs text-kv-dim">
                                  +{hidden} more
                                </span>
                              ) : null}
                            </div>
                          )}
                        </td>
                        <td className="px-3 py-3 text-right font-money tabular-nums text-kv-white">
                          {product.totalStock}
                        </td>
                        <td className="px-3 py-3 text-center">
                          <div className="inline-flex">
                            <StatusPill product={product} />
                          </div>
                        </td>
                        <td className="px-4 py-3 text-right sm:px-5">
                          <Money value={product.price * product.totalStock} className="text-2xs" />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}