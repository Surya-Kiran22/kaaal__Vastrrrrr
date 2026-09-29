import { Link } from '@tanstack/react-router';
import { motion } from 'framer-motion';
import { Archive, ArchiveRestore, Pencil, Plus, Search, Star, Trash2, EyeOff } from 'lucide-react';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { ErrorBoundary } from '@/components/ui/error-boundary';
import { EmptyState, ErrorState, Skeleton, toErrorMessage } from '@/components/ui/states';
import { useAdminProducts } from '@/hooks/useProducts';
import {
  useDeleteProduct,
  useSetProductArchived,
  useSetProductFeatured,
} from '@/hooks/useAdminMutations';
import { formatPrice, formatRelativeDate } from '@/lib/format';
import { cn } from '@/lib/utils';

type Filter = 'all' | 'live' | 'archived' | 'soldout';

const FILTERS: Array<{ value: Filter; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'live', label: 'Live' },
  { value: 'soldout', label: 'Sold out' },
  { value: 'archived', label: 'Archived' },
];

export function AdminProductsPage() {
  const { data: products = [], isPending, isError, error, refetch } = useAdminProducts();
  const archive = useSetProductArchived();
  const remove = useDeleteProduct();
  const feature = useSetProductFeatured();

  const [term, setTerm] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [pendingDelete, setPendingDelete] = useState<{ id: string; name: string } | null>(null);

  const visible = useMemo(() => {
    const needle = term.trim().toLowerCase();
    return products.filter((product) => {
      if (filter === 'live' && (product.is_archived || !product.is_available)) return false;
      if (filter === 'archived' && !product.is_archived) return false;
      if (filter === 'soldout' && (product.is_archived || product.inStock)) return false;
      if (!needle) return true;
      return (
        product.name.toLowerCase().includes(needle) ||
        product.sku.toLowerCase().includes(needle) ||
        product.category.toLowerCase().includes(needle)
      );
    });
  }, [products, term, filter]);

  if (isPending) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-9 w-48" />
        <Skeleton className="h-11 w-full max-w-sm" />
        {Array.from({ length: 5 }, (_, index) => (
          <Skeleton key={index} className="h-20 w-full rounded-xl" />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-7">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
        <p className="text-xs uppercase tracking-[0.4em] text-kv-muted">Catalogue</p>
        <h1 className="mt-2 text-4xl">Products</h1>
        <p className="mt-1 text-sm text-kv-muted">
            {isError
              ? 'Catalogue unavailable'
              : `${products.length} product${products.length === 1 ? '' : 's'} · ${
                  products.filter((product) => !product.is_archived).length
                } visible to customers`}
          </p>
        </div>
        <Button asChild>
          <Link to="/admin/products/new">
            <Plus className="h-4 w-4" />
            Add product
          </Link>
        </Button>
      </header>

      {/* Toolbar ------------------------------------------------------- */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative max-w-sm flex-1">
          <Search
            className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-kv-dim"
            aria-hidden
          />
          <Input
            value={term}
            onChange={(event) => setTerm(event.target.value)}
            placeholder="Search name, SKU or category…"
            aria-label="Search products"
            className="pl-10"
            type="search"
          />
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {FILTERS.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => setFilter(option.value)}
              aria-pressed={filter === option.value}
              className={cn(
                'rounded-full border px-3.5 py-1.5 text-2xs uppercase tracking-wider transition-all duration-300',
                filter === option.value
                  ? 'border-kv-white bg-kv-white text-kv-bg'
                  : 'border-kv-line text-kv-muted hover:border-kv-lineStrong hover:text-kv-white',
              )}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      {/* List ---------------------------------------------------------- */}
      {/*
        An empty catalogue and a failed query look identical from here, so the
        error has to be checked first. The heading, search box and filters stay
        on screen: the admin can still reach "Add product" and retry without
        losing their place.
      */}
      <ErrorBoundary label="the product list" onRetry={() => void refetch()}>
        {isError ? (
          <ErrorState
            title="Could not load products"
            message={toErrorMessage(error)}
            onRetry={() => void refetch()}
          />
        ) : visible.length === 0 ? (
        <EmptyState
          icon={<Search className="h-6 w-6" />}
          title={products.length === 0 ? 'No products yet' : 'Nothing matches those filters'}
          description={
            products.length === 0
              ? 'Add your first clothing product to publish it on the storefront.'
              : 'Try a different search term or switch the filter.'
          }
          action={
            products.length === 0 ? (
              <Button asChild>
                <Link to="/admin/products/new">
                  <Plus className="h-4 w-4" />
                  Add product
                </Link>
              </Button>
            ) : (
              <Button
                variant="outline"
                onClick={() => {
                  setTerm('');
                  setFilter('all');
                }}
              >
                Clear filters
              </Button>
            )
          }
        />
      ) : (
        <ul className="space-y-2.5">
          {visible.map((product, index) => (
            <motion.li
              key={product.id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, delay: Math.min(index, 8) * 0.03 }}
              className={cn(
                'rounded-xl border border-kv-line bg-kv-card p-4 transition-colors duration-300',
                product.is_archived && 'opacity-65',
              )}
            >
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
                {/* Thumb + meta ------------------------------------------ */}
                <div className="flex min-w-0 flex-1 items-center gap-4">
                  <Link
                    to="/admin/products/$productId"
                    params={{ productId: product.id }}
                    // The thumbnail is decorative (alt="") and the fallback is a
                    // dash, so without this the link has no accessible name at
                    // all -- three tab stops per row, two of them unnamed.
                    aria-label={`Edit ${product.name}`}
                    className="h-16 w-14 shrink-0 overflow-hidden rounded-lg border border-kv-line bg-kv-raised"
                  >
                    {product.primaryImage ? (
                      <img
                        src={product.primaryImage}
                        alt=""
                        loading="lazy"
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <span className="flex h-full w-full items-center justify-center text-2xs text-kv-dim">
                        —
                      </span>
                    )}
                  </Link>

                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link
                        to="/admin/products/$productId"
                        params={{ productId: product.id }}
                        className="truncate text-sm font-medium text-kv-white transition-colors hover:text-kv-silver"
                      >
                        {product.name}
                      </Link>
                      {product.is_archived ? (
                        <Badge tone="neutral">Archived</Badge>
                      ) : !product.is_available ? (
                        <Badge tone="neutral">Hidden</Badge>
                      ) : product.inStock ? (
                        <Badge tone="success">Live</Badge>
                      ) : (
                        <Badge tone="warning">Sold out</Badge>
                      )}
                      {product.is_featured ? <Badge tone="bright">Featured</Badge> : null}
                    </div>
                    <p className="mt-1.5 truncate text-2xs uppercase tracking-wider text-kv-dim">
                      {product.sku} · {product.category} · {product.sizes.length} sizes ·{' '}
                      {product.colors.length} colours
                    </p>
                    <p className="mt-1 text-2xs text-kv-dim">
                      {product.totalStock} units · updated {formatRelativeDate(product.updated_at)}
                    </p>
                  </div>
                </div>

                {/* Price + actions --------------------------------------- */}
                <div className="flex items-center justify-between gap-4 sm:justify-end">
                  <div className="text-right">
                    <p className="text-sm tabular-nums text-kv-white">{formatPrice(product.price)}</p>
                    {product.compareAt ? (
                      <p className="text-2xs tabular-nums text-kv-dim line-through">
                        {formatPrice(product.compareAt)}
                      </p>
                    ) : null}
                  </div>

                  <div className="flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={product.is_featured ? 'Remove from featured' : 'Feature on home page'}
                      title={product.is_featured ? 'Remove from featured' : 'Feature on home page'}
                      onClick={() =>
                        feature.mutate({ id: product.id, featured: !product.is_featured })
                      }
                    >
                      <Star
                        className={cn(
                          'h-4 w-4',
                          product.is_featured ? 'fill-kv-white text-kv-white' : 'text-kv-dim',
                        )}
                      />
                    </Button>

                    <Button asChild variant="ghost" size="icon-sm" aria-label={`Edit ${product.name}`}>
                      <Link to="/admin/products/$productId" params={{ productId: product.id }}>
                        <Pencil className="h-4 w-4" />
                      </Link>
                    </Button>

                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={
                        product.is_archived ? `Restore ${product.name}` : `Archive ${product.name}`
                      }
                      title={product.is_archived ? 'Restore to storefront' : 'Archive (hide from customers)'}
                      loading={archive.isPending && archive.variables?.id === product.id}
                      onClick={() =>
                        archive.mutate({ id: product.id, archived: !product.is_archived })
                      }
                    >
                      {product.is_archived ? (
                        <ArchiveRestore className="h-4 w-4" />
                      ) : (
                        <Archive className="h-4 w-4" />
                      )}
                    </Button>

                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Delete ${product.name} permanently`}
                      title="Delete permanently"
                      onClick={() => setPendingDelete({ id: product.id, name: product.name })}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </div>
            </motion.li>
          ))}
        </ul>
      )}
      </ErrorBoundary>

      {/* Archive hint -------------------------------------------------- */}
      {products.length > 0 && !isError ? (
        <p className="flex items-center gap-2 text-2xs text-kv-dim">
          <EyeOff className="h-3 w-3" aria-hidden />
          Archiving hides a product from customers while keeping its record. Deleting is permanent — prefer
          archiving.
        </p>
      ) : null}

      {/* Delete confirmation ------------------------------------------- */}
      <Dialog open={Boolean(pendingDelete)} onOpenChange={(open) => !open && setPendingDelete(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete this product permanently?</DialogTitle>
            <DialogDescription>
              “{pendingDelete?.name}” and its stock records will be removed for good. Archiving keeps the data
              and is reversible — it is almost always the better choice.
            </DialogDescription>
          </DialogHeader>
          <DialogBody className="text-sm text-kv-muted">
            Images already uploaded to storage stay in the bucket and can be removed separately.
          </DialogBody>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setPendingDelete(null)}>
              Cancel
            </Button>
            <Button
              variant="secondary"
              onClick={() => {
                if (!pendingDelete) return;
                archive.mutate({ id: pendingDelete.id, archived: true });
                setPendingDelete(null);
              }}
            >
              <Archive className="h-4 w-4" />
              Archive instead
            </Button>
            <Button
              variant="danger"
              loading={remove.isPending}
              onClick={() => {
                if (!pendingDelete) return;
                remove.mutate(pendingDelete.id, {
                  onSuccess: () => setPendingDelete(null),
                  onError: (mutationError) => {
                    toast.error(toErrorMessage(mutationError, 'Could not delete this product.'));
                    setPendingDelete(null);
                  },
                });
              }}
            >
              <Trash2 className="h-4 w-4" />
              Delete permanently
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
