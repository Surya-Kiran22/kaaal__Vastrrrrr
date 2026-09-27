import { Link } from '@tanstack/react-router';
import { motion } from 'framer-motion';
import { Trash2 } from 'lucide-react';
import { QuantityStepper } from './quantity-stepper';
import { formatPrice } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { CartLine } from '@/types';

interface CartLineItemProps {
  line: CartLine;
  onQuantityChange: (id: string, quantity: number) => void;
  onRemove: (id: string) => void;
  compact?: boolean;
}

export function CartLineItem({ line, onQuantityChange, onRemove, compact = false }: CartLineItemProps) {
  const variant = [line.color, line.size].filter(Boolean).join(' / ');
  const lineTotal = line.unitPrice * line.quantity;

  return (
    <motion.li
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, height: 0, marginBottom: 0 }}
      transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
      className="flex gap-4 py-4"
    >
      <Link
        to="/product/$slug"
        params={{ slug: line.slug }}
        className={cn(
          'media-frame shrink-0 overflow-hidden rounded-lg border border-kv-line bg-kv-raised',
          compact ? 'h-24 w-20' : 'h-28 w-24',
        )}
        aria-label={line.name}
      >
        {line.image ? (
          <img
            src={line.image}
            alt={line.name}
            loading="lazy"
            className="h-full w-full object-cover transition-transform duration-500 ease-premium hover:scale-105"
          />
        ) : (
          <span className="flex h-full w-full items-center justify-center text-2xs text-kv-dim">
            No image
          </span>
        )}
      </Link>

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <Link
              to="/product/$slug"
              params={{ slug: line.slug }}
              className="line-clamp-2 text-sm font-medium leading-snug text-kv-white transition-colors hover:text-kv-silver"
            >
              {line.name}
            </Link>
            <p className="mt-1 truncate text-2xs uppercase tracking-wider text-kv-dim">
              {line.sku}
              {variant ? ` · ${variant}` : ''}
            </p>
          </div>
          <button
            type="button"
            onClick={() => onRemove(line.id)}
            aria-label={`Remove ${line.name} from cart`}
            className="shrink-0 rounded-full p-1.5 text-kv-dim transition-colors duration-200 hover:bg-kv-danger/10 hover:text-kv-danger"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>

        <div className="mt-auto flex items-end justify-between gap-3 pt-3">
          <QuantityStepper
            size="sm"
            value={line.quantity}
            min={1}
            max={line.maxQuantity}
            onChange={(next) => onQuantityChange(line.id, next)}
          />
          <div className="text-right">
            <p className="text-sm font-medium tabular-nums text-kv-white">{formatPrice(lineTotal)}</p>
            {line.quantity > 1 ? (
              <p className="text-2xs tabular-nums text-kv-dim">{formatPrice(line.unitPrice)} each</p>
            ) : null}
          </div>
        </div>
      </div>
    </motion.li>
  );
}
