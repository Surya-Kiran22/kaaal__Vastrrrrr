import { Link, useNavigate, useParams } from '@tanstack/react-router';
import { motion } from 'framer-motion';
import {
  ArrowLeft,
  Check,
  ChevronRight,
  MessageCircle,
  PackageX,
  ShieldCheck,
  Truck,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { ProductGallery } from '@/components/product/product-gallery';
import { VariantSelector } from '@/components/product/variant-selector';
import { ProductCard } from '@/components/product/product-card';
import { QuantityStepper } from '@/components/cart/quantity-stepper';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ErrorState, Skeleton } from '@/components/ui/states';
import { useCart } from '@/features/cart/cart-context';
import { useCartDrawer } from '@/features/cart/cart-drawer-context';
import { useOrderGate } from '@/hooks/useOrderGate';
import { useBusinessSettings, useProductBySlug, useProducts } from '@/hooks/useProducts';
import { discountPercent, formatPrice } from '@/lib/format';
import { variantUnits } from '@/lib/products';
import { buildWhatsappChatLink } from '@/lib/whatsapp';

export function ProductDetailPage() {
  const { slug } = useParams({ from: '/product/$slug' });
  const navigate = useNavigate();
const { addItem, quantityOf } = useCart();
  const { open: openCart } = useCartDrawer();
const { requireCustomer } = useOrderGate();
  const { data: business } = useBusinessSettings();

  const { data: product, isPending, isError, error, refetch } = useProductBySlug(slug);
  const { data: related = [], isPending: relatedPending } = useProducts({ category: product?.category });

  const [color, setColor] = useState<string | null>(null);
  const [size, setSize] = useState<string | null>(null);
  const [quantity, setQuantity] = useState(1);
  const [validationMessage, setValidationMessage] = useState<string | null>(null);

  // Default to the first in-stock combination so the page never starts invalid.
  useEffect(() => {
    if (!product) return;
    const firstColor = product.colors[0] ?? null;
    const firstAvailable =
      product.sizes.find((candidate) => variantUnits(product, firstColor, candidate) > 0) ?? null;
    setColor(firstColor);
    setSize(firstAvailable);
    setQuantity(1);
    setValidationMessage(null);
  }, [product]);

  const units = useMemo(
    () => (product ? variantUnits(product, color, size) : 0),
    [product, color, size],
  );

  const maxQuantity = product
    ? Math.max(1, Math.min(units, product.maxSelectableQuantity, 10))
    : 1;

  useEffect(() => {
    setQuantity((prev) => Math.min(Math.max(1, prev), maxQuantity));
  }, [maxQuantity]);

  // Shared validation for both actions so a sold-out combination is reported
  // before anything is added or navigated.
  const validateSelection = (): boolean => {
    if (!product) return false;
    if (product.sizes.length > 0 && !size) {
      setValidationMessage('Please choose a size first.');
      return false;
    }
    if (product.colors.length > 0 && !color) {
      setValidationMessage('Please choose a colour first.');
      return false;
    }
    if (units <= 0) {
      setValidationMessage('That combination is sold out. Try another size or colour.');
      return false;
    }
    setValidationMessage(null);
    return true;
  };

  const handleAdd = () => {
    if (!validateSelection()) return;
    // Ordering happens in exactly one place now, from the cart, so adding to the
    // cart is the only action this page offers. It stays gated: an anonymous
    // visitor gets the sign-in prompt with a way through it, rather than the
    // bare "please sign in to start shopping" toast that addItem would raise on
    // its own and which leaves them stuck on a product they cannot buy.
    requireCustomer(() => {
      const result = addItem({ product: product!, color, size, quantity, units });
      if (result.added) openCart();
    });
  };

  if (isPending) {
    return (
      <div className="container-kv py-12 lg:py-16">
        <div className="grid gap-10 lg:grid-cols-2 lg:gap-16">
          <Skeleton className="aspect-[4/5] w-full rounded-2xl" />
          <div className="space-y-5">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-10 w-3/4" />
            <Skeleton className="h-6 w-32" />
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-32 w-full" />
          </div>
        </div>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="container-kv py-20">
        <ErrorState
          title="Could not load this product"
          message={error instanceof Error ? error.message : 'Please try again.'}
          onRetry={() => void refetch()}
        />
      </div>
    );
  }

  if (!product) {
    return (
      <div className="container-kv flex min-h-[60dvh] flex-col items-center justify-center py-24 text-center">
        <div className="mb-7 flex h-16 w-16 items-center justify-center rounded-full border border-kv-line bg-kv-surface text-kv-muted">
          <PackageX className="h-7 w-7" />
        </div>
        <p className="eyebrow">Unavailable</p>
        <h1 className="heading-display mt-4">This piece is no longer listed</h1>
        <p className="mt-4 max-w-md text-sm leading-relaxed text-kv-muted">
          It may have sold out or been archived by the store. Browse the collection to find something similar.
        </p>
        <div className="mt-9 flex flex-wrap items-center justify-center gap-3">
          <Button asChild size="lg">
            <Link to="/shop">Browse the collection</Link>
          </Button>
          <Button asChild variant="outline" size="lg">
            <Link to="/">
              <ArrowLeft className="h-4 w-4" />
              Back home
            </Link>
          </Button>
        </div>
      </div>
    );
  }

  const off = discountPercent(product.price, product.compareAt);
  const inCart = quantityOf(product.id, color, size);
  const soldOut = units <= 0;
  const whatsapp = buildWhatsappChatLink(business?.whatsapp_number);

  const relatedProducts = related
    .filter((candidate) => candidate.id !== product.id)
    .slice(0, 4);

  return (
    <div className="pb-10">
      {/* Breadcrumb ------------------------------------------------------ */}
      <div className="container-kv pt-7">
        <nav aria-label="Breadcrumb" className="flex items-center gap-1.5 text-2xs uppercase tracking-widest text-kv-dim">
          <Link to="/" className="transition-colors hover:text-kv-silver">
            Home
          </Link>
          <ChevronRight className="h-3 w-3" aria-hidden />
          <Link to="/shop" className="transition-colors hover:text-kv-silver">
            Shop
          </Link>
          <ChevronRight className="h-3 w-3" aria-hidden />
          <button
            type="button"
            onClick={() => void navigate({ to: '/shop', search: { category: product.category } })}
            className="transition-colors hover:text-kv-silver"
          >
            {product.category}
          </button>
          <ChevronRight className="h-3 w-3" aria-hidden />
          <span className="truncate text-kv-silver">{product.name}</span>
        </nav>
      </div>

      <div className="container-kv mt-7 grid gap-10 lg:grid-cols-2 lg:gap-16">
        <motion.div
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.55, ease: [0.22, 1, 0.36, 1] }}
        >
          <ProductGallery images={product.gallery} alt={product.name} />
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.55, delay: 0.08, ease: [0.22, 1, 0.36, 1] }}
          className="lg:sticky lg:top-32 lg:self-start"
        >
          <p className="eyebrow">{product.brand}</p>
          <h1 className="mt-3 font-display text-3xl leading-tight tracking-tight text-kv-white sm:text-4xl">
            {product.name}
          </h1>

          <div className="mt-4 flex flex-wrap items-center gap-3">
            <span className="font-display text-2xl tabular-nums text-kv-white">
              {formatPrice(product.price)}
            </span>
            {product.compareAt ? (
              <>
                <span className="text-base tabular-nums text-kv-dim line-through">
                  {formatPrice(product.compareAt)}
                </span>
                {off ? <Badge tone="bright">Save {off}%</Badge> : null}
              </>
            ) : null}
          </div>

          <p className="mt-2 text-2xs uppercase tracking-widest text-kv-dim">
            SKU {product.sku} · {product.stock > 0 ? `${product.stock} in stock` : 'Out of stock'}
          </p>

          {product.description ? (
            <p className="mt-7 whitespace-pre-line text-pretty text-sm leading-relaxed text-kv-muted">
              {product.description}
            </p>
          ) : null}

          <div className="my-8">
            <VariantSelector
              product={product}
              color={color}
              size={size}
              onColorChange={(next) => {
                setColor(next);
                setValidationMessage(null);
              }}
              onSizeChange={(next) => {
                setSize(next);
                setValidationMessage(null);
              }}
            />
          </div>

          {/* Availability ------------------------------------------------ */}
          <div className="mb-5 flex flex-wrap items-center gap-2.5">
            {soldOut ? (
              <Badge tone="danger" size="md">
                Sold out in this combination
              </Badge>
            ) : units <= 3 ? (
              <Badge tone="warning" size="md">
                Only {units} left
              </Badge>
            ) : (
              <Badge tone="success" size="md">
                <Check className="h-3 w-3" aria-hidden /> In stock
              </Badge>
            )}
            {inCart > 0 ? (
              <Badge tone="neutral" size="md">
                {inCart} already in your cart
              </Badge>
            ) : null}
          </div>

          {/* Quantity + CTA ---------------------------------------------- */}
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-xs uppercase tracking-widest text-kv-muted">Quantity</span>
              <QuantityStepper
                value={quantity}
                min={1}
                max={maxQuantity}
                onChange={setQuantity}
                label="Quantity"
              />
            </div>

            {validationMessage ? (
              <p role="alert" className="text-sm text-kv-danger">
                {validationMessage}
              </p>
            ) : null}

            <Button size="lg" onClick={handleAdd} disabled={soldOut} block>
              {soldOut ? 'Sold out' : 'Add to cart'}
            </Button>

            {whatsapp && !soldOut ? (
              <p className="text-center text-2xs text-kv-dim">
                Prefer to talk first?{' '}
                <a
                  href={whatsapp}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-kv-silver underline-offset-4 hover:underline"
                >
                  Message {business?.business_name ?? 'us'}
                </a>{' '}
                about this piece.
              </p>
            ) : null}
          </div>

          {/* Assurance -------------------------------------------------- */}
          <ul className="mt-9 grid gap-3 border-t border-kv-line pt-7 sm:grid-cols-2">
            {[
              { icon: Truck, text: 'Store pickup or courier across India' },
              { icon: ShieldCheck, text: 'Confirm availability before dispatch' },
              { icon: MessageCircle, text: 'Order and pay over WhatsApp' },
              { icon: PackageX, text: '7-day exchange on unworn pieces' },
            ].map((item) => (
              <li key={item.text} className="flex items-start gap-2.5 text-xs text-kv-muted">
                <item.icon className="mt-px h-3.5 w-3.5 shrink-0 text-kv-dim" aria-hidden />
                {item.text}
              </li>
            ))}
          </ul>
        </motion.div>
      </div>

      {/* Related --------------------------------------------------------- */}
      {relatedProducts.length > 0 || relatedPending ? (
        <section className="container-kv mt-24 border-t border-kv-line pt-16">
          <p className="eyebrow">You may also like</p>
          <h2 className="mt-3 font-display text-2xl tracking-tight text-kv-white sm:text-3xl">
            More in {product.category}
          </h2>
          <div className="mt-9">
            {relatedPending ? (
              <div className="grid grid-cols-2 gap-x-4 gap-y-10 sm:gap-x-5 lg:grid-cols-4">
                {Array.from({ length: 4 }, (_, index) => (
                  <div key={index} className="space-y-3">
                    <Skeleton className="aspect-[3/4] w-full rounded-xl" />
                    <Skeleton className="h-3 w-4/5" />
                    <Skeleton className="h-3 w-1/3" />
                  </div>
                ))}
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-x-4 gap-y-10 sm:gap-x-5 lg:grid-cols-4">
                {relatedProducts.map((candidate, index) => (
                  <ProductCard key={candidate.id} product={candidate} index={index} />
                ))}
              </div>
            )}
          </div>
        </section>
      ) : null}
    </div>
  );
}
