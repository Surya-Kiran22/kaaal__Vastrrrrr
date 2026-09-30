import type { Product, StoreProduct, VariantStock } from '@/types';
import { isValidHttpUrl } from './utils';

export const PRODUCT_IMAGE_FALLBACK = '/images/placeholder-product.svg';

function toNumber(value: unknown, fallback = 0): number {
  const parsed = typeof value === 'number' ? value : Number.parseFloat(String(value ?? ''));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => String(entry).trim()).filter((entry) => entry.length > 0);
}

function toImageList(value: unknown): string[] {
  return toStringArray(value).filter((entry) => isValidHttpUrl(entry) || entry.startsWith('/'));
}

/** `"Colour|Size"` -> units. Malformed keys are ignored rather than throwing. */
export function normaliseVariantStock(value: unknown): VariantStock | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length === 0) return null;

  const output: VariantStock = {};
  for (const [key, raw] of entries) {
    if (!key.includes('|')) continue;
    output[key] = Math.max(0, Math.trunc(toNumber(raw, 0)));
  }
  return Object.keys(output).length > 0 ? output : null;
}

/** Units for one colour+size pair. Falls back to flat stock when unmapped. */
export function variantUnits(
  product: Pick<Product, 'variant_stock' | 'stock' | 'colors' | 'sizes'>,
  color: string | null,
  size: string | null,
): number {
  const hasVariants =
    Array.isArray(product.variant_stock) === false &&
    product.variant_stock !== null &&
    typeof product.variant_stock === 'object' &&
    Object.keys(product.variant_stock as VariantStock).length > 0;

  if (hasVariants) {
    // A product with variant stock tracks per-variant only; unmapped = sold out.
    if (!color || !size) return 0;
    return (product.variant_stock as VariantStock)[`${color}|${size}`] ?? 0;
  }

  if (Array.isArray(product.colors) && product.colors.length > 0 && !color) return 0;
  if (Array.isArray(product.sizes) && product.sizes.length > 0 && !size) return 0;
  return Math.max(0, toNumber(product.stock, 0));
}

/** Options a shopper may actually pick, with per-option stock counts. */
export interface VariantOption {
  label: string;
  units: number;
  inStock: boolean;
}

export function sizeOptions(product: Product): VariantOption[] {
  const sizes = toStringArray(product.sizes);
  const hasVariants = Boolean(product.variant_stock && Object.keys(product.variant_stock).length > 0);
  return sizes.map((size) => {
    const units = hasVariants
      ? (product.colors ?? []).reduce((sum, color) => sum + (product.variant_stock?.[`${color}|${size}`] ?? 0), 0)
      : toNumber(product.stock, 0);
    return { label: size, units, inStock: units > 0 };
  });
}

export function colorOptions(product: Product): VariantOption[] {
  const colors = toStringArray(product.colors);
  const hasVariants = Boolean(product.variant_stock && Object.keys(product.variant_stock).length > 0);
  return colors.map((color) => {
    const units = hasVariants
      ? (product.sizes ?? []).reduce((sum, size) => sum + (product.variant_stock?.[`${color}|${size}`] ?? 0), 0)
      : toNumber(product.stock, 0);
    return { label: color, units, inStock: units > 0 };
  });
}

/** Single source of truth for turning a DB row into a render-ready product. */
export function toStoreProduct(row: Product): StoreProduct {
  const price = toNumber(row.selling_price, 0);
  const compareAt = row.compare_at_price == null ? null : toNumber(row.compare_at_price, 0);
  const gallery = toImageList(row.images);
  const primaryImage = toImageList(row.image_url)[0] ?? gallery[0] ?? null;
  const variantStock = normaliseVariantStock(row.variant_stock);
  const totalStock = variantStock
    ? Object.values(variantStock).reduce((sum, units) => sum + units, 0)
    : Math.max(0, toNumber(row.stock, 0));

  return {
    ...row,
    selling_price: price,
    compare_at_price: compareAt,
    sizes: toStringArray(row.sizes),
    colors: toStringArray(row.colors),
    images: gallery,
    variant_stock: variantStock,
    price,
    compareAt: compareAt && compareAt > price ? compareAt : null,
    primaryImage,
    gallery: gallery.length > 0 ? gallery : primaryImage ? [primaryImage] : [],
    totalStock,
    inStock: Boolean(row.is_available) && !row.is_archived && totalStock > 0,
    maxSelectableQuantity: Math.max(1, Math.min(totalStock, 10)),
  };
}

export function toStoreProducts(rows: Product[] | null | undefined): StoreProduct[] {
  return Array.isArray(rows) ? rows.map(toStoreProduct) : [];
}

/**
 * Mirrors `products_variant_stock_is_valid` so a write is rejected here with a
 * readable message instead of a Postgres exception.
 *
 * The trigger raises when a key has no `|`, or when a value is negative or not a
 * whole number. Note the companion `products_sync_total_stock` trigger treats an
 * empty `{}` object as "not variant tracked" and then reads the flat `stock`
 * column instead, which is why callers must not write an empty map.
 */
export function validateVariantStock(stock: VariantStock): string | null {
  for (const [key, units] of Object.entries(stock)) {
    if (!key.includes('|')) {
      return `"${key}" needs a colour and a size, like "Black|M".`;
    }
    if (!Number.isInteger(units) || units < 0) {
      return `${key} must be a whole number of units, zero or more.`;
    }
  }
  return null;
}

/**
 * True when the new total is zero, which the sync trigger turns into
 * `is_available = false` on the storefront. The trigger never flips it back, so
 * the admin has to re-publish the product by hand; worth saying out loud.
 */
export function zeroesOutAvailability(stock: VariantStock): boolean {
  return Object.keys(stock).length > 0 && Object.values(stock).every((units) => units === 0);
}

