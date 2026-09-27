import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { isSupabaseConfigured } from '@/lib/env';
import { supabase } from '@/lib/supabase';
import { businessKeys, productKeys } from '@/hooks/useProducts';
import type { BusinessSettings, Product, VariantStock } from '@/types';

const PRODUCT_COLUMNS =
  'id, name, slug, category, brand, sku, description, selling_price, compare_at_price, sizes, colors, variant_stock, stock, image_url, images, is_featured, is_available, is_archived, created_at, updated_at';

const SETTINGS_COLUMNS =
  'id, business_name, tagline, description, whatsapp_number, mobile_number, email, address, city, state, pincode, store_timings, gst_number, upi_id, instagram_url, facebook_url, logo_url, hero_image_url, updated_at';

/** Shape written by the admin product form. */
export interface ProductInput {
  name: string;
  slug: string;
  category: string;
  brand: string;
  sku: string;
  description: string | null;
  selling_price: number;
  compare_at_price: number | null;
  sizes: string[];
  colors: string[];
  variant_stock: VariantStock | null;
  /** Only used when `variant_stock` is null — the trigger derives the total otherwise. */
  stock: number;
  image_url: string | null;
  images: string[];
  is_featured: boolean;
  is_available: boolean;
  is_archived: boolean;
}

function toPayload(input: ProductInput): Record<string, unknown> {
  return {
    name: input.name.trim(),
    slug: input.slug.trim(),
    category: input.category.trim(),
    brand: input.brand.trim() || 'Kaal Vastr',
    sku: input.sku.trim().toUpperCase(),
    description: input.description?.trim() || null,
    selling_price: input.selling_price,
    compare_at_price: input.compare_at_price,
    sizes: input.sizes,
    colors: input.colors,
    variant_stock: input.variant_stock,
    stock: input.variant_stock ? 0 : Math.max(0, Math.trunc(input.stock)),
    image_url: input.image_url,
    images: input.images,
    is_featured: input.is_featured,
    is_available: input.is_available,
    is_archived: input.is_archived,
  };
}

function assertConfigured(): void {
  if (!isSupabaseConfigured) {
    throw new Error('Supabase is not configured. Check your .env file.');
  }
}

export function useCreateProduct() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: ProductInput): Promise<Product> => {
      assertConfigured();
      const { data, error } = await supabase
        .from('products')
        .insert(toPayload(input))
        .select(PRODUCT_COLUMNS)
        .single();

      if (error) throw error;
      return data as Product;
    },
    onSuccess: (product) => {
      void queryClient.invalidateQueries({ queryKey: productKeys.all });
      toast.success('Product created', { description: `${product.name} is now on the storefront.` });
    },
  });
}

export function useUpdateProduct() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      id,
      input,
    }: {
      id: string;
      input: ProductInput;
    }): Promise<Product> => {
      assertConfigured();
      const { data, error } = await supabase
        .from('products')
        .update(toPayload(input))
        .eq('id', id)
        .select(PRODUCT_COLUMNS)
        .single();

      if (error) throw error;
      return data as Product;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: productKeys.all });
      toast.success('Product updated', { description: 'The storefront now shows the latest data.' });
    },
  });
}

export function useSetProductArchived() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, archived }: { id: string; archived: boolean }): Promise<void> => {
      assertConfigured();
      const { error } = await supabase.from('products').update({ is_archived: archived }).eq('id', id);
      if (error) throw error;
    },
    onSuccess: (_data, variables) => {
      void queryClient.invalidateQueries({ queryKey: productKeys.all });
      toast.success(
        variables.archived ? 'Product archived' : 'Product restored',
        {
          description: variables.archived
            ? 'It is hidden from the storefront but the record is preserved.'
            : 'It is visible on the storefront again.',
        },
      );
    },
  });
}

export function useSetProductAvailability() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, available }: { id: string; available: boolean }): Promise<void> => {
      assertConfigured();
      const { error } = await supabase.from('products').update({ is_available: available }).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: productKeys.all });
    },
  });
}

export function useSetProductFeatured() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, featured }: { id: string; featured: boolean }): Promise<void> => {
      assertConfigured();
      const { error } = await supabase.from('products').update({ is_featured: featured }).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: productKeys.all });
    },
  });
}

export function useDeleteProduct() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string): Promise<void> => {
      assertConfigured();
      const { error } = await supabase.from('products').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: productKeys.all });
      toast.success('Product permanently deleted');
    },
  });
}

export interface UploadedImage {
  path: string;
  publicUrl: string;
}

const BUCKET = 'product-images';

/** Uploads to Supabase Storage under `products/<uuid>/<file>` and returns a public URL. */
export function useUploadProductImage() {
  return useMutation({
    mutationFn: async (file: File): Promise<UploadedImage> => {
      assertConfigured();

      if (!file.type.startsWith('image/')) {
        throw new Error('Please choose an image file.');
      }
      if (file.size > 5 * 1024 * 1024) {
        throw new Error('Images must be 5 MB or smaller.');
      }

      const extension = (file.name.split('.').pop() ?? 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '');
      const folder = crypto.randomUUID();
      const path = `products/${folder}/${Date.now()}.${extension || 'jpg'}`;

      const { error } = await supabase.storage.from(BUCKET).upload(path, file, {
        cacheControl: '31536000',
        upsert: false,
        contentType: file.type,
      });

      if (error) throw error;

      const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
      return { path, publicUrl: data.publicUrl };
    },
  });
}

export function useDeleteStoredImage() {
  return useMutation({
    mutationFn: async (path: string): Promise<void> => {
      assertConfigured();
      const { error } = await supabase.storage.from(BUCKET).remove([path]);
      if (error) throw error;
    },
  });
}

/** Storage keys we own, so external image URLs are never deleted. */
export function storagePathFromUrl(url: string): string | null {
  if (!isSupabaseConfigured) return null;
  const marker = `${supabaseConfigUrl()}/${BUCKET}/`;
  if (!url.startsWith(marker)) return null;
  return url.slice(marker.length);
}

function supabaseConfigUrl(): string {
  // Kept separate so the storage marker stays in one place.
  return (import.meta.env.VITE_SUPABASE_URL ?? '').replace(/\/$/, '');
}

export function useUpdateBusinessSettings() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: Partial<BusinessSettings>): Promise<BusinessSettings> => {
      assertConfigured();
      const payload = { ...input, id: 'biz-001' };
      const { data, error } = await supabase
        .from('business_settings')
        .upsert(payload, { onConflict: 'id' })
        .select(SETTINGS_COLUMNS)
        .single();

      if (error) throw error;
      return data as BusinessSettings;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: businessKeys.settings });
      toast.success('Business settings saved');
    },
  });
}
