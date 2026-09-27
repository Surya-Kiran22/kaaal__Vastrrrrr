import { Link, useNavigate, useSearch } from '@tanstack/react-router';
import { motion } from 'framer-motion';
import { Search, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ProductCard } from '@/components/product/product-card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { EmptyState, ErrorState, ProductGridSkeleton } from '@/components/ui/states';
import { useCategories, useProducts, PRODUCT_SORT_OPTIONS, type ProductSort } from '@/hooks/useProducts';
import { cn } from '@/lib/utils';

export interface ShopSearch {
  category?: string;
  q?: string;
  sort?: ProductSort;
}

export function ShopPage() {
  const search = useSearch({ from: '/shop' });
  const navigate = useNavigate();
  const [term, setTerm] = useState(search.q ?? '');

  const category = search.category;
  const sort = search.sort ?? 'newest';

  const { data: categories = [], isPending: categoriesPending } = useCategories();
  const { data: products = [], isPending, isError, error, refetch, isFetching } = useProducts({
    category,
    search: search.q,
    sort,
  });

  // Keep the input in sync when the URL changes (back button, category click).
  useEffect(() => {
    setTerm(search.q ?? '');
  }, [search.q]);

  // Debounce the search box so we do not hit PostgREST on every keystroke.
  useEffect(() => {
    if ((search.q ?? '') === term.trim()) return undefined;
    const timer = window.setTimeout(() => {
      void navigate({
        to: '/shop',
        search: (prev) => ({ ...prev, q: term.trim() || undefined }),
        replace: true,
      });
    }, 320);
    return () => window.clearTimeout(timer);
  }, [term, search.q, navigate]);

  const setSearch = useCallback(
    (patch: Partial<ShopSearch>) => {
      void navigate({
        to: '/shop',
        search: (prev) => {
          const next = { ...prev, ...patch };
          return {
            category: next.category,
            q: next.q,
            sort: next.sort,
          };
        },
        replace: true,
      });
    },
    [navigate],
  );

  const activeFilters = useMemo(() => {
    const list: Array<{ key: string; label: string; clear: () => void }> = [];
    if (category && category !== 'All') {
      list.push({ key: 'category', label: category, clear: () => setSearch({ category: undefined }) });
    }
    if (search.q) {
      list.push({ key: 'q', label: `“${search.q}”`, clear: () => setSearch({ q: undefined }) });
    }
    return list;
  }, [category, search.q, setSearch]);

  const heading = category && category !== 'All' ? category : 'The collection';

  return (
    <div className="container-kv py-12 lg:py-16">
      {/* Header ---------------------------------------------------------- */}
      <motion.header
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
        className="max-w-2xl"
      >
        <p className="eyebrow">Shop</p>
        <h1 className="mt-3 font-display text-4xl tracking-tight text-kv-white sm:text-5xl">{heading}</h1>
        <p className="mt-4 text-pretty text-sm leading-relaxed text-kv-muted sm:text-base">
          Every piece below is in stock right now. Select your size, add to cart, and confirm the order on
          WhatsApp.
        </p>
      </motion.header>

      {/* Toolbar --------------------------------------------------------- */}
      <div className="sticky top-[6.25rem] z-30 -mx-5 mt-10 border-y border-kv-line bg-kv-bg/90 px-5 py-3 backdrop-blur-xl lg:top-[7rem]">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="relative flex-1">
            <Search
              className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-kv-dim"
              aria-hidden
            />
            <Input
              value={term}
              onChange={(event) => setTerm(event.target.value)}
              placeholder="Search by name, SKU or category…"
              aria-label="Search products"
              className="pl-10"
              type="search"
            />
          </div>

          <div className="flex items-center gap-2">
            <Select
              value={sort}
              onValueChange={(value) => setSearch({ sort: value as ProductSort })}
            >
              <SelectTrigger className="sm:w-52" aria-label="Sort products">
                <SelectValue placeholder="Sort" />
              </SelectTrigger>
              <SelectContent>
                {PRODUCT_SORT_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Category chips ------------------------------------------------- */}
        <div className="-mx-1 mt-3 flex items-center gap-1.5 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <CategoryChip
            active={!category || category === 'All'}
            onClick={() => setSearch({ category: undefined })}
            disabled={categoriesPending}
          >
            All
          </CategoryChip>
          {categories.map((option) => (
            <CategoryChip
              key={option}
              active={category === option}
              onClick={() => setSearch({ category: option })}
            >
              {option}
            </CategoryChip>
          ))}
        </div>
      </div>

      {/* Meta row -------------------------------------------------------- */}
      <div className="mt-7 flex flex-wrap items-center justify-between gap-3">
        <p className="flex items-center gap-2 text-xs uppercase tracking-widest text-kv-dim">
          {isPending ? (
            'Loading products…'
          ) : (
            <>
              {products.length} piece{products.length === 1 ? '' : 's'}
              {isFetching ? <span className="text-kv-silver">· updating…</span> : null}
            </>
          )}
        </p>

        {activeFilters.length > 0 ? (
          <div className="flex flex-wrap items-center gap-2">
            {activeFilters.map((filter) => (
              <button
                key={filter.key}
                type="button"
                onClick={filter.clear}
                className="group inline-flex items-center gap-1.5 rounded-full border border-kv-line bg-kv-surface px-3 py-1 text-2xs uppercase tracking-wider text-kv-silver transition-colors hover:border-kv-lineStrong hover:text-kv-white"
              >
                {filter.label}
                <X className="h-3 w-3 opacity-60 group-hover:opacity-100" aria-hidden />
              </button>
            ))}
            <button
              type="button"
              onClick={() => setSearch({ category: undefined, q: undefined })}
              className="text-2xs uppercase tracking-wider text-kv-dim underline-offset-4 transition-colors hover:text-kv-white hover:underline"
            >
              Clear all
            </button>
          </div>
        ) : null}
      </div>

      {/* Grid ------------------------------------------------------------ */}
      <div className="mt-8">
        {isPending ? (
          <ProductGridSkeleton count={8} />
        ) : isError ? (
          <ErrorState
            title="Could not load products"
            message={error instanceof Error ? error.message : 'Please try again.'}
            onRetry={() => void refetch()}
          />
        ) : products.length === 0 ? (
          <EmptyState
            icon={<Search className="h-6 w-6" />}
            title="Nothing matches those filters"
            description={
              search.q || category
                ? 'Try a different search term or clear the filters to see the full collection.'
                : 'No products are published yet. Add them from the store admin to see them here.'
            }
            action={
              <Button variant="outline" onClick={() => setSearch({ category: undefined, q: undefined })}>
                Clear filters
              </Button>
            }
          />
        ) : (
          <div
            className={cn(
              'grid grid-cols-2 gap-x-4 gap-y-10 transition-opacity duration-300 sm:gap-x-5 lg:grid-cols-3 xl:grid-cols-4',
              isFetching && 'opacity-60',
            )}
          >
            {products.map((product, index) => (
              <ProductCard key={product.id} product={product} index={index} priority={index < 8} />
            ))}
          </div>
        )}
      </div>

      {!isPending && products.length > 0 ? (
        <p className="mt-14 text-center text-xs text-kv-dim">
          Showing all {products.length} available pieces.{' '}
          <Link to="/contact" className="text-kv-silver underline-offset-4 hover:underline">
            Ask us about a size
          </Link>
          .
        </p>
      ) : null}
    </div>
  );
}

function CategoryChip({
  active,
  onClick,
  disabled,
  children,
}: {
  active: boolean;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={active}
      className={cn(
        'shrink-0 rounded-full border px-3.5 py-1.5 text-2xs uppercase tracking-wider transition-all duration-300 ease-premium',
        active
          ? 'border-kv-white bg-kv-white text-kv-bg'
          : 'border-kv-line text-kv-muted hover:border-kv-lineStrong hover:text-kv-white',
      )}
    >
      {children}
    </button>
  );
}
