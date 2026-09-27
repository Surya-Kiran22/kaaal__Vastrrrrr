import { keepPreviousData } from '@tanstack/react-query';
import { ConfigError, isSupabaseConfigured } from '@/lib/env';
import { toStoreProducts } from '@/lib/products';
import { supabase } from '@/lib/supabase';
import { useLiveQuery } from '@/hooks/useRealtime';
import type { BusinessSettings, Product, StoreProduct } from '@/types';

export const productKeys = {
  all: ['products'] as const,
  list: (filters: ProductFilters) => ['products', 'list', filters] as const,
  detail: (slug: string) => ['products', 'detail', slug] as const,
  categories: ['products', 'categories'] as const,
  adminList: ['products', 'admin'] as const,
};
export type ProductSort = 'newest' | 'price-asc' | 'price-desc' | 'name-asc';

export interface ProductFilters {
  category?: string;
  search?: string;
  sort?: ProductSort;
  featuredOnly?: boolean;
}

const PRODUCT_COLUMNS =
  'id, name, slug, category, brand, sku, description, selling_price, compare_at_price, sizes, colors, variant_stock, stock, image_url, images, is_featured, is_available, is_archived, created_at, updated_at';

const SORTS: Record<ProductSort, { column: keyof Product; ascending: boolean }> = {
  newest: { column: 'created_at', ascending: false },
  'price-asc': { column: 'selling_price', ascending: true },
  'price-desc': { column: 'selling_price', ascending: false },
  'name-asc': { column: 'name', ascending: true },
};

export const PRODUCT_SORT_OPTIONS: Array<{ value: ProductSort; label: string }> = [
  { value: 'newest', label: 'Newest first' },
  { value: 'price-asc', label: 'Price: low to high' },
  { value: 'price-desc', label: 'Price: high to low' },
  { value: 'name-asc', label: 'Name: A to Z' },
];

/** Throws a readable ConfigError instead of hanging on a disabled query. */
function assertConfigured(): void {
  if (!isSupabaseConfigured) throw new ConfigError();
}

/** Public catalogue read. RLS already hides archived and unavailable rows. */
export function useProducts(filters: ProductFilters = {}) {
  const { category, search, sort = 'newest', featuredOnly = false } = filters;
  const term = search?.trim() ?? '';

  return useLiveQuery(
    {
      queryKey: productKeys.list({ category, search: term, sort, featuredOnly }),
      placeholderData: keepPreviousData,
      queryFn: async (): Promise<StoreProduct[]> => {
        assertConfigured();

        let query = supabase
          .from('products')
          .select(PRODUCT_COLUMNS)
          .eq('is_archived', false)
          .eq('is_available', true);

        if (category && category !== 'All') query = query.eq('category', category);
        if (featuredOnly) query = query.eq('is_featured', true);
        if (term) {
          // PostgREST `or` filter — values must not contain commas or parens.
          const safe = term.replace(/[,()*]/g, ' ').trim();
          if (safe) {
            const pattern = `%${safe}%`;
            query = query.or(
              `name.ilike.${pattern},sku.ilike.${pattern},category.ilike.${pattern},brand.ilike.${pattern},description.ilike.${pattern}`,
            );
          }
        }

        const { data, error } = await query.order(SORTS[sort].column, {
          ascending: SORTS[sort].ascending,
        });

        if (error) throw error;
        return toStoreProducts(data as Product[]);
      },
    },
    // Sold-out state changes should appear without a reload.
    { tables: ['products'] },
  );
}

export function useProductBySlug(slug: string | undefined) {
  return useLiveQuery(
    {
      queryKey: productKeys.detail(slug ?? ''),
      queryFn: async (): Promise<StoreProduct | null> => {
        assertConfigured();
        if (!slug) return null;

        const { data, error } = await supabase
          .from('products')
          .select(PRODUCT_COLUMNS)
          .eq('slug', slug)
          .maybeSingle();

        if (error) throw error;
        if (!data) return null;

        const product = toStoreProducts([data as Product])[0];
        // A public visitor must never see archived or unavailable records.
        return product.is_archived || !product.is_available ? null : product;
      },
    },
    { tables: ['products'] },
  );
}

/** Admin read: includes archived and unavailable rows. */
export function useAdminProducts() {
  return useLiveQuery(
    {
      queryKey: productKeys.adminList,
      queryFn: async (): Promise<StoreProduct[]> => {
        assertConfigured();
        const { data, error } = await supabase
          .from('products')
          .select(PRODUCT_COLUMNS)
          .order('updated_at', { ascending: false });

        if (error) throw error;
        return toStoreProducts(data as Product[]);
      },
    },
    // Two editors in the same tab, or an editor and a customer, should agree.
    { tables: ['products'] },
  );
}

export function useCategories() {
  return useLiveQuery(
    {
      queryKey: productKeys.categories,
      staleTime: 5 * 60 * 1000,
      queryFn: async (): Promise<string[]> => {
        assertConfigured();
        const { data, error } = await supabase
          .from('products')
          .select('category')
          .eq('is_archived', false)
          .eq('is_available', true);

        if (error) throw error;
        const categories = new Set<string>();
        for (const row of (data ?? []) as Array<{ category: string }>) {
          if (row.category) categories.add(row.category);
        }
        return [...categories].sort((a, b) => a.localeCompare(b));
      },
    },
    // Derived from the catalogue, so it must not drift from it.
    { tables: ['products'] },
  );
}

export const businessKeys = {
  settings: ['business-settings'] as const,
};

/** Store configuration. `biz-001` is the singleton enforced by a CHECK constraint. */
export function useBusinessSettings() {
  return useLiveQuery(
    {
      queryKey: businessKeys.settings,
      staleTime: 10 * 60 * 1000,
      queryFn: async (): Promise<BusinessSettings | null> => {
        assertConfigured();
        const { data, error } = await supabase
          .from('business_settings')
          .select('*')
          .eq('id', 'biz-001')
          .maybeSingle();

        if (error) throw error;
        return (data as BusinessSettings | null) ?? null;
      },
    },
    // The store WhatsApp number is read at checkout time, so an edit must reach
    // an open tab rather than waiting out the stale time.
    { tables: ['business_settings'] },
  );
}
