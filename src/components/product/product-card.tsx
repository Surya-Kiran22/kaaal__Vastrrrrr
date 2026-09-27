import { Link, useNavigate } from '@tanstack/react-router';
import { motion } from 'framer-motion';
import { Plus } from 'lucide-react';
import { useState } from 'react';
import { useCart } from '@/features/cart/cart-context';
import { useCartDrawer } from '@/features/cart/cart-drawer-context';
import { discountPercent, formatPrice } from '@/lib/format';
import { colorOptions } from '@/lib/products';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import type { StoreProduct } from '@/types';

interface ProductCardProps {
  product: StoreProduct;
  index?: number;
  priority?: boolean;
}

export function ProductCard({ product, index = 0, priority = false }: ProductCardProps) {
  const { addItem } = useCart();
  const { open } = useCartDrawer();
  const navigate = useNavigate();
  const [failed, setFailed] = useState(false);

  const off = discountPercent(product.price, product.compareAt);
  const colors = colorOptions(product);
  const swatches = colors.slice(0, 4);
  const lowStock = product.inStock && product.totalStock <= 5;
  const soldOut = !product.inStock;

  // A product with exactly one buyable combination can be added without a detour.
  const singleVariant = product.sizes.length <= 1 && product.colors.length <= 1;

  const quickAdd = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();

    if (singleVariant) {
      addItem({
        product,
        size: product.sizes[0] ?? null,
        color: product.colors[0] ?? null,
        quantity: 1,
        units: product.totalStock,
      });
      open();
      return;
    }
    void navigate({ to: '/product/$slug', params: { slug: product.slug } });
  };

  return (
    <motion.article
      initial={{ opacity: 0, y: 16 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-40px' }}
      transition={{ duration: 0.5, delay: Math.min(index, 7) * 0.05, ease: [0.22, 1, 0.36, 1] }}
      className="group relative"
    >
      <div className="media-frame relative aspect-[3/4] rounded-xl border border-kv-line">
        {product.primaryImage && !failed ? (
          <>
            <img
              src={product.primaryImage}
              alt={product.name}
              loading={priority ? 'eager' : 'lazy'}
              decoding="async"
              onError={() => setFailed(true)}
              className="h-full w-full object-cover transition-transform duration-700 ease-premium group-hover:scale-[1.04]"
            />
            {product.gallery[1] ? (
              <img
                src={product.gallery[1]}
                alt=""
                aria-hidden
                loading="lazy"
                decoding="async"
                className="absolute inset-0 h-full w-full object-cover opacity-0 transition-opacity duration-700 ease-premium group-hover:opacity-100"
              />
            ) : null}
          </>
        ) : (
          <div className="flex h-full w-full items-center justify-center px-4 text-center text-2xs uppercase tracking-widest text-kv-dim">
            No image
          </div>
        )}

        <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-kv-bg/60 via-transparent to-transparent opacity-0 transition-opacity duration-500 group-hover:opacity-100" />

        <div className="pointer-events-none absolute left-3 top-3 z-30 flex flex-col items-start gap-1.5">
          {off ? <Badge tone="bright">-{off}%</Badge> : null}
          {soldOut ? <Badge tone="neutral">Sold out</Badge> : null}
          {!soldOut && lowStock ? <Badge tone="warning">Only {product.totalStock} left</Badge> : null}
        </div>

        {!soldOut ? (
          <button
            type="button"
            onClick={quickAdd}
            aria-label={`Add ${product.name} to cart`}
            className="absolute bottom-3 right-3 z-30 flex h-10 w-10 items-center justify-center rounded-full bg-kv-white text-kv-bg opacity-0 shadow-lift transition-all duration-300 ease-premium hover:bg-kv-light focus-visible:opacity-100 group-hover:opacity-100 max-md:opacity-100"
          >
            <Plus className="h-4 w-4" />
          </button>
        ) : null}
      </div>

      {/* Full-card link overlay keeps one accessible link per product. */}
      <Link
        to="/product/$slug"
        params={{ slug: product.slug }}
        className="absolute inset-0 z-20 rounded-xl focus:outline-none focus-visible:ring-2 focus-visible:ring-kv-white/70"
        aria-label={product.name}
      />

      <div className="pointer-events-none relative mt-4 space-y-1.5">
        <div className="flex items-start justify-between gap-3">
          <h3 className="text-sm font-medium leading-snug text-kv-white transition-colors duration-300 group-hover:text-kv-silver">
            {product.name}
          </h3>
          <div className="shrink-0 text-right">
            <p className="text-sm tabular-nums text-kv-white">{formatPrice(product.price)}</p>
            {product.compareAt ? (
              <p className="text-2xs tabular-nums text-kv-dim line-through">
                {formatPrice(product.compareAt)}
              </p>
            ) : null}
          </div>
        </div>
        <p className="text-2xs uppercase tracking-widest text-kv-dim">{product.category}</p>

        {swatches.length > 0 ? (
          <div className="flex items-center gap-1.5 pt-1">
            {swatches.map((option) => (
              <span
                key={option.label}
                title={`${option.label}${option.inStock ? '' : ' — sold out'}`}
                className={cn(
                  'h-2.5 w-2.5 rounded-full border border-kv-lineStrong',
                  option.inStock ? 'bg-kv-silver' : 'bg-kv-line',
                )}
              />
            ))}
            {colors.length > swatches.length ? (
              <span className="text-2xs text-kv-dim">+{colors.length - swatches.length}</span>
            ) : null}
          </div>
        ) : null}
      </div>
    </motion.article>
  );
}
