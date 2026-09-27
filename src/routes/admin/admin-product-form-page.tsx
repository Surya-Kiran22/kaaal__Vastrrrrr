import { zodResolver } from '@hookform/resolvers/zod';
import { Link, useNavigate, useParams } from '@tanstack/react-router';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Eye, Save } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Controller, useForm, type Control } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';
import { ProductImageManager } from './product-image-manager';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Field, Input, Textarea } from '@/components/ui/input';
import { ErrorState, Skeleton, toErrorMessage } from '@/components/ui/states';
import { useCreateProduct, useUpdateProduct, type ProductInput } from '@/hooks/useAdminMutations';
import { productKeys } from '@/hooks/useProducts';
import { supabase } from '@/lib/supabase';
import { slugify } from '@/lib/utils';
import type { Product } from '@/types';

const CATEGORIES = [
  'Hoodies',
  'T-Shirts',
  'Shirts',
  'Jackets',
  'Trousers',
  'Sweaters',
  'Accessories',
] as const;

const schema = z
  .object({
    name: z.string().trim().min(3, 'Product name must be at least 3 characters.').max(120),
    slug: z
      .string()
      .trim()
      .min(3, 'Slug is required for the product URL.')
      .max(140)
      .regex(
        /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
        'Use lowercase letters, numbers and single hyphens only.',
      ),
    category: z.string().trim().min(2, 'Choose a category.'),
    brand: z.string().trim().min(2, 'Brand is required.').max(60),
    sku: z
      .string()
      .trim()
      .min(3, 'SKU must be at least 3 characters.')
      .max(40)
      .regex(/^[A-Za-z0-9._-]+$/, 'Use letters, numbers, dots, dashes or underscores only.'),
    description: z.string().trim().max(2000, 'Keep the description under 2000 characters.'),
    selling_price: z.coerce
      .number({ invalid_type_error: 'Enter the selling price.' })
      .min(1, 'Selling price must be at least 1.')
      .max(1_000_000, 'That price looks too high.'),
    compare_at_price: z
      .union([z.coerce.number().min(0), z.literal(0), z.nan(), z.null(), z.undefined()])
      .transform((value) =>
        typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null,
      ),
    sizesText: z.string().trim().min(1, 'Add at least one size.'),
    colorsText: z.string().trim().max(400),
    useVariantStock: z.boolean(),
    flat_stock: z.coerce.number().int().min(0, 'Stock cannot be negative.').max(99_999),
    variant_stock: z.record(z.string(), z.number().int().min(0).max(9999)),
    is_featured: z.boolean(),
    is_available: z.boolean(),
    is_archived: z.boolean(),
  })
  .superRefine((values, ctx) => {
    if (values.compare_at_price != null && values.compare_at_price <= values.selling_price) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['compare_at_price'],
        message: 'The original price must be higher than the selling price.',
      });
    }
  });

type FormValues = z.infer<typeof schema>;

interface ImageValue {
  image_url: string | null;
  images: string[];
}

function splitList(value: string): string[] {
  return value
    .split(/[,\n]/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function seedVariantStock(sizes: string[], colors: string[], fallback: number): Record<string, number> {
  const combinations = Math.max(1, colors.length * sizes.length);
  const perVariant = Math.max(0, Math.trunc(fallback / combinations));
  const grid: Record<string, number> = {};
  for (const color of colors) {
    for (const size of sizes) {
      grid[`${color}|${size}`] = perVariant;
    }
  }
  return grid;
}

/**
 * Rebuilds the grid for the current size/colour lists while keeping any units the
 * admin already entered for combinations that still exist.
 */
function reconcileVariantStock(
  previous: Record<string, number> | undefined,
  sizes: string[],
  colors: string[],
  fallback: number,
): Record<string, number> {
  const seeded = seedVariantStock(sizes, colors, fallback);
  const next: Record<string, number> = {};
  for (const key of Object.keys(seeded)) {
    const existing = previous?.[key];
    next[key] = typeof existing === 'number' && Number.isFinite(existing) ? existing : seeded[key];
  }
  return next;
}

export function AdminProductFormPage({ productId }: { productId?: string }) {
  const isEdit = Boolean(productId);
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const createProduct = useCreateProduct();
  const updateProduct = useUpdateProduct();

  const [existing, setExisting] = useState<Product | null>(null);
  const [images, setImages] = useState<ImageValue>({ image_url: null, images: [] });
  const [loading, setLoading] = useState(isEdit);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [slugTouched, setSlugTouched] = useState(false);

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    mode: 'onBlur',
    defaultValues: {
      name: '',
      slug: '',
      category: 'Hoodies',
      brand: 'Kaal Vastr',
      sku: '',
      description: '',
      selling_price: undefined,
      compare_at_price: undefined,
      sizesText: 'S, M, L, XL',
      colorsText: '',
      useVariantStock: false,
      flat_stock: 0,
      variant_stock: {},
      is_featured: false,
      is_available: true,
      is_archived: false,
    },
  });

  const {
    register,
    handleSubmit,
    control,
    reset,
    setValue,
    watch,
    formState: { errors, isSubmitting, isDirty },
  } = form;

  const values = watch();
  const sizes = useMemo(() => splitList(values.sizesText), [values.sizesText]);
  const colors = useMemo(() => splitList(values.colorsText), [values.colorsText]);
  const sizeKey = sizes.join('|');
  const colorKey = colors.join('|');

  // Load the product being edited.
  useEffect(() => {
    if (!productId) {
      setLoading(false);
      return undefined;
    }

    let cancelled = false;
    (async () => {
      try {
        const { data, error } = await supabase
          .from('products')
          .select('*')
          .eq('id', productId)
          .maybeSingle();

        if (cancelled) return;
        if (error) throw error;
        if (!data) {
          setLoadError('This product no longer exists.');
          return;
        }

        const product = data as Product;
        const hasVariants = Boolean(product.variant_stock && Object.keys(product.variant_stock).length > 0);

        setExisting(product);
        setImages({ image_url: product.image_url, images: product.images ?? [] });
        setSlugTouched(true);
        reset({
          name: product.name,
          slug: product.slug,
          category: product.category,
          brand: product.brand,
          sku: product.sku,
          description: product.description ?? '',
          selling_price: Number(product.selling_price),
          compare_at_price:
            product.compare_at_price == null ? undefined : Number(product.compare_at_price),
          sizesText: product.sizes.join(', '),
          colorsText: product.colors.join(', '),
          useVariantStock: hasVariants,
          flat_stock: product.stock,
          variant_stock: hasVariants ? (product.variant_stock as Record<string, number>) : {},
          is_featured: product.is_featured,
          is_available: product.is_available,
          is_archived: product.is_archived,
        });
      } catch (queryError) {
        if (!cancelled) setLoadError(toErrorMessage(queryError, 'Could not load this product.'));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [productId, reset]);

  // Mirror the name into the slug until the admin edits the slug directly.
  useEffect(() => {
    if (slugTouched) return;
    setValue('slug', slugify(values.name), { shouldValidate: false, shouldDirty: true });
  }, [values.name, slugTouched, setValue]);

  // Turning on per-variant stock seeds the grid, and list edits only add/remove
  // the affected rows instead of discarding units already entered.
  const variantSignature = values.useVariantStock ? `${sizeKey}::${colorKey}` : null;
  const lastSeededSignature = useRef<string | null>(null);

  useEffect(() => {
    if (!variantSignature) return;
    if (lastSeededSignature.current === variantSignature) return;
    lastSeededSignature.current = variantSignature;
    setValue(
      'variant_stock',
      reconcileVariantStock(values.variant_stock, sizes, colors, values.flat_stock ?? 0),
      { shouldValidate: false },
    );
  }, [variantSignature, sizes, colors, values.variant_stock, values.flat_stock, setValue]);

  const totalUnits = values.useVariantStock
    ? Object.values(values.variant_stock ?? {}).reduce((sum, units) => sum + (Number(units) || 0), 0)
    : (values.flat_stock ?? 0);

  const onSubmit = handleSubmit(async (formValues) => {
    const hasGrid = formValues.useVariantStock && colors.length > 0 && sizes.length > 0;

    const payload: ProductInput = {
      name: formValues.name,
      slug: formValues.slug,
      category: formValues.category,
      brand: formValues.brand,
      sku: formValues.sku,
      description: formValues.description || null,
      selling_price: formValues.selling_price,
      compare_at_price: formValues.compare_at_price,
      sizes,
      colors,
      variant_stock: hasGrid ? formValues.variant_stock : null,
      stock: hasGrid ? 0 : formValues.flat_stock,
      image_url: images.image_url,
      images: images.images,
      is_featured: formValues.is_featured,
      is_available: formValues.is_available,
      is_archived: formValues.is_archived,
    };

    try {
      if (isEdit && productId) {
        await updateProduct.mutateAsync({ id: productId, input: payload });
        setImages({ image_url: payload.image_url, images: payload.images });
        await queryClient.invalidateQueries({ queryKey: productKeys.all });
        toast.success('Product updated', { description: 'The storefront now shows the latest data.' });
      } else {
        const created = await createProduct.mutateAsync(payload);
        await queryClient.invalidateQueries({ queryKey: productKeys.all });
        void navigate({ to: '/admin/products/$productId', params: { productId: created.id } });
      }
    } catch (error) {
      toast.error(toErrorMessage(error, 'Could not save this product.'));
    }
  });

  if (loading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-9 w-64" />
        <Skeleton className="h-72 w-full rounded-xl" />
        <Skeleton className="h-72 w-full rounded-xl" />
      </div>
    );
  }

  if (loadError) {
    return (
      <ErrorState
        title="Product unavailable"
        message={loadError}
        onRetry={() => window.location.reload()}
      />
    );
  }

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-7">
      {/* Header --------------------------------------------------------- */}
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link
            to="/admin/products"
            className="inline-flex items-center gap-2 text-2xs uppercase tracking-widest text-kv-dim transition-colors hover:text-kv-silver"
          >
            <ArrowLeft className="h-3 w-3" aria-hidden />
            All products
          </Link>
          <h1 className="mt-4 font-display text-3xl tracking-tight text-kv-white">
            {isEdit ? 'Edit product' : 'Add product'}
          </h1>
          {isEdit && existing ? (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Badge tone="neutral">SKU {existing.sku}</Badge>
              <Badge tone="neutral">Created {new Date(existing.created_at).getFullYear()}</Badge>
              {existing.is_archived ? <Badge tone="warning">Archived</Badge> : null}
            </div>
          ) : null}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {isEdit && existing && !existing.is_archived ? (
            <Button asChild variant="outline" size="sm">
              <a href={`/product/${existing.slug}`} target="_blank" rel="noopener noreferrer">
                <Eye className="h-3.5 w-3.5" />
                Preview
              </a>
            </Button>
          ) : null}
          <Button type="submit" loading={isSubmitting} loadingText="Saving…" disabled={isSubmitting}>
            <Save className="h-4 w-4" />
            {isEdit ? 'Save changes' : 'Create product'}
          </Button>
        </div>
      </header>

      {/* Basics --------------------------------------------------------- */}
      <Panel title="Basics" description="What customers see first on the card and the product page.">
        <div className="grid gap-5 sm:grid-cols-2">
          <Field
            label="Product name"
            htmlFor="name"
            required
            className="sm:col-span-2"
            error={errors.name?.message}
          >
            <Input
              id="name"
              placeholder="Shadow Oversized Hoodie"
              aria-invalid={Boolean(errors.name)}
              {...register('name')}
            />
          </Field>

          <Field
            label="URL slug"
            htmlFor="slug"
            required
            hint={isEdit ? 'Changing this breaks existing links' : 'Auto-generated from the name'}
            error={errors.slug?.message}
          >
            <Input
              id="slug"
              placeholder="shadow-oversized-hoodie"
              aria-invalid={Boolean(errors.slug)}
              onChange={(event) => {
                setSlugTouched(true);
                setValue('slug', slugify(event.target.value), {
                  shouldValidate: true,
                  shouldDirty: true,
                });
              }}
              value={values.slug}
            />
          </Field>

          <Field label="SKU" htmlFor="sku" required error={errors.sku?.message}>
            <Input
              id="sku"
              placeholder="KV-HD-001"
              className="font-mono"
              aria-invalid={Boolean(errors.sku)}
              {...register('sku')}
            />
          </Field>

          <Field label="Category" htmlFor="category" required error={errors.category?.message}>
            <select
              id="category"
              aria-invalid={Boolean(errors.category)}
              className="h-11 w-full rounded-lg border border-kv-line bg-kv-surface px-3.5 text-sm text-kv-white transition-colors hover:border-kv-lineStrong focus:border-kv-white/50 focus:outline-none focus:ring-1 focus:ring-kv-white/30"
              {...register('category')}
            >
              {CATEGORIES.map((option) => (
                <option key={option} value={option} className="bg-kv-raised">
                  {option}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Brand / collection" htmlFor="brand" required error={errors.brand?.message}>
            <Input
              id="brand"
              placeholder="Kaal Vastr"
              aria-invalid={Boolean(errors.brand)}
              {...register('brand')}
            />
          </Field>

          <Field
            label="Description"
            htmlFor="description"
            className="sm:col-span-2"
            hint="Fabric weight, fit, care instructions"
            error={errors.description?.message}
          >
            <Textarea
              id="description"
              rows={5}
              placeholder="Heavyweight 450 GSM French-terry cotton hoodie in deep obsidian black…"
              aria-invalid={Boolean(errors.description)}
              {...register('description')}
            />
          </Field>
        </div>
      </Panel>

      {/* Pricing -------------------------------------------------------- */}
      <Panel
        title="Pricing"
        description="Prices are in Indian rupees. Leave the original price empty if the piece is not discounted."
      >
        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="Selling price" htmlFor="selling_price" required error={errors.selling_price?.message}>
            <div className="relative">
              <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-sm text-kv-dim">
                ₹
              </span>
              <Input
                id="selling_price"
                type="number"
                step="1"
                min="0"
                inputMode="numeric"
                className="pl-8"
                placeholder="4499"
                aria-invalid={Boolean(errors.selling_price)}
                {...register('selling_price')}
              />
            </div>
          </Field>

          <Field
            label="Original price"
            htmlFor="compare_at_price"
            hint="Optional — shown struck through"
            error={errors.compare_at_price?.message}
          >
            <div className="relative">
              <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-sm text-kv-dim">
                ₹
              </span>
              <Input
                id="compare_at_price"
                type="number"
                step="1"
                min="0"
                inputMode="numeric"
                className="pl-8"
                placeholder="5999"
                aria-invalid={Boolean(errors.compare_at_price)}
                {...register('compare_at_price')}
              />
            </div>
          </Field>
        </div>
      </Panel>

      {/* Variants ------------------------------------------------------- */}
      <Panel
        title="Sizes, colours and stock"
        description="Comma separated. Turn on per-variant stock when sizes sell out unevenly."
      >
        <div className="grid gap-5 sm:grid-cols-2">
          <Field
            label="Sizes"
            htmlFor="sizesText"
            required
            hint="e.g. S, M, L, XL"
            error={errors.sizesText?.message}
          >
            <Input id="sizesText" placeholder="S, M, L, XL" {...register('sizesText')} />
          </Field>

          <Field
            label="Colours"
            htmlFor="colorsText"
            hint="Leave empty for a single-colour product"
            error={errors.colorsText?.message}
          >
            <Input id="colorsText" placeholder="Obsidian Black, Charcoal Grey" {...register('colorsText')} />
          </Field>
        </div>

        {colors.length > 0 && sizes.length > 0 ? (
          <div className="mt-5">
            <Controller
              control={control}
              name="useVariantStock"
              render={({ field }) => (
                <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-kv-line bg-kv-surface p-4 transition-colors hover:border-kv-lineStrong">
                  <input
                    type="checkbox"
                    checked={field.value}
                    onChange={(event) => field.onChange(event.target.checked)}
                    className="mt-0.5 h-4 w-4 shrink-0 accent-white"
                  />
                  <span>
                    <span className="block text-sm text-kv-white">Track stock per size and colour</span>
                    <span className="mt-1 block text-2xs leading-relaxed text-kv-dim">
                      {colors.length * sizes.length} combinations. A cell at 0 is sold out — the storefront
                      disables that option automatically.
                    </span>
                  </span>
                </label>
              )}
            />
          </div>
        ) : null}

        {values.useVariantStock && colors.length > 0 && sizes.length > 0 ? (
          <VariantStockGrid
            control={control}
            colors={colors}
            sizes={sizes}
            hasError={Boolean(errors.variant_stock)}
          />
        ) : (
          <div className="mt-5 max-w-xs">
            <Field
              label="Total units in stock"
              htmlFor="flat_stock"
              required
              hint="Applies to every size"
              error={errors.flat_stock?.message}
            >
              <Input
                id="flat_stock"
                type="number"
                step="1"
                min="0"
                inputMode="numeric"
                className="tabular-nums"
                aria-invalid={Boolean(errors.flat_stock)}
                {...register('flat_stock')}
              />
            </Field>
          </div>
        )}

        <div className="mt-5 flex flex-wrap items-center gap-4 rounded-lg border border-kv-line bg-kv-surface px-4 py-3">
          <span className="text-2xs uppercase tracking-widest text-kv-dim">Total sellable units</span>
          <span className="text-sm tabular-nums text-kv-white">{totalUnits}</span>
          {totalUnits === 0 ? (
            <span className="text-2xs text-kv-warning">
              The database marks this product unavailable until stock is added.
            </span>
          ) : null}
        </div>
      </Panel>

      {/* Images --------------------------------------------------------- */}
      <Panel title="Images" description="Upload to Supabase Storage or attach external image URLs.">
        <ProductImageManager formValue={images} onChange={setImages} />
      </Panel>

      {/* Visibility ----------------------------------------------------- */}
      <Panel title="Visibility" description="Control exactly what customers can see.">
        <div className="space-y-3">
          <Controller
            control={control}
            name="is_available"
            render={({ field }) => (
              <ToggleRow
                label="Available on the storefront"
                hint="Turn off to hide this product without archiving it."
                checked={field.value}
                onChange={field.onChange}
              />
            )}
          />
          <Controller
            control={control}
            name="is_featured"
            render={({ field }) => (
              <ToggleRow
                label="Feature on the home page"
                hint="Featured pieces appear in the home page showcase."
                checked={field.value}
                onChange={field.onChange}
              />
            )}
          />
          <Controller
            control={control}
            name="is_archived"
            render={({ field }) => (
              <ToggleRow
                label="Archived"
                hint="Archived products keep their record but never reach customers."
                checked={field.value}
                onChange={field.onChange}
              />
            )}
          />
        </div>
      </Panel>

      {/* Sticky actions -------------------------------------------------- */}
      <div className="sticky bottom-0 -mx-5 flex flex-wrap items-center justify-between gap-3 border-t border-kv-line bg-kv-bg/90 px-5 py-4 backdrop-blur-xl">
        <p className="text-2xs text-kv-dim">{isDirty ? 'You have unsaved changes.' : 'No pending changes.'}</p>
        <div className="flex items-center gap-2">
          <Button asChild variant="ghost" size="sm">
            <Link to="/admin/products">Back to list</Link>
          </Button>
          <Button type="submit" size="sm" loading={isSubmitting} disabled={isSubmitting}>
            <Save className="h-3.5 w-3.5" />
            {isEdit ? 'Save changes' : 'Create product'}
          </Button>
        </div>
      </div>
    </form>
  );
}

/* -------------------------------------------------------------------------- */
/* Presentational pieces                                                       */
/* -------------------------------------------------------------------------- */

function Panel({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-kv-line bg-kv-card p-6">
      <div className="mb-6">
        <h2 className="font-display text-lg tracking-tight text-kv-white">{title}</h2>
        {description ? <p className="mt-1.5 text-xs text-kv-dim">{description}</p> : null}
      </div>
      {children}
    </section>
  );
}

function ToggleRow({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-kv-line bg-kv-surface p-4 transition-colors hover:border-kv-lineStrong">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="mt-0.5 h-4 w-4 shrink-0 accent-white"
      />
      <span>
        <span className="block text-sm text-kv-white">{label}</span>
        <span className="mt-1 block text-2xs leading-relaxed text-kv-dim">{hint}</span>
      </span>
    </label>
  );
}

function VariantStockGrid({
  control,
  colors,
  sizes,
  hasError,
}: {
  control: Control<FormValues>;
  colors: string[];
  sizes: string[];
  hasError: boolean;
}) {
  return (
    <div className="mt-5 overflow-x-auto rounded-xl border border-kv-line">
      <table className="w-full min-w-[34rem] border-collapse text-sm">
        <caption className="sr-only">Stock units for each colour and size combination</caption>
        <thead>
          <tr className="border-b border-kv-line bg-kv-surface">
            <th
              scope="col"
              className="px-4 py-3 text-left text-2xs uppercase tracking-widest text-kv-dim"
            >
              Colour / Size
            </th>
            {sizes.map((size) => (
              <th
                key={size}
                scope="col"
                className="px-3 py-3 text-center text-2xs uppercase tracking-widest text-kv-dim"
              >
                {size}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {colors.map((color) => (
            <tr key={color} className="border-b border-kv-line last:border-0">
              <th scope="row" className="whitespace-nowrap px-4 py-2.5 text-left font-normal text-kv-silver">
                {color}
              </th>
              {sizes.map((size) => (
                <td key={size} className="px-2 py-2 text-center">
                  <Controller
                    control={control}
                    name={`variant_stock.${color}|${size}` as const}
                    render={({ field }) => (
                      <input
                        type="number"
                        min={0}
                        max={9999}
                        step={1}
                        inputMode="numeric"
                        value={String(field.value ?? 0)}
                        onChange={(event) =>
                          field.onChange(Math.max(0, Math.trunc(Number(event.target.value) || 0)))
                        }
                        onBlur={field.onBlur}
                        name={field.name}
                        ref={field.ref}
                        aria-label={`${color}, size ${size} stock`}
                        className="h-9 w-16 rounded-md border border-kv-line bg-kv-surface text-center text-sm tabular-nums text-kv-white transition-colors hover:border-kv-lineStrong focus:border-kv-white/50 focus:outline-none focus:ring-1 focus:ring-kv-white/30"
                      />
                    )}
                  />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {hasError ? (
        <p role="alert" className="border-t border-kv-line px-4 py-3 text-xs text-kv-danger">
          Stock values must be whole numbers of zero or more.
        </p>
      ) : null}
    </div>
  );
}

export { CATEGORIES };

/** Route wrapper for `/admin/products/new`. */
export function AdminProductNewPage() {
  return <AdminProductFormPage />;
}

/** Route wrapper for `/admin/products/$productId`. */
export function AdminProductEditPage() {
  const { productId } = useParams({ from: '/admin/products/$productId' });
  return <AdminProductFormPage productId={productId} />;
}
