import { Check } from 'lucide-react';
import { colorOptions, sizeOptions, variantUnits } from '@/lib/products';
import { cn } from '@/lib/utils';
import type { Product } from '@/types';

interface VariantSelectorProps {
  product: Product;
  color: string | null;
  size: string | null;
  onColorChange: (color: string | null) => void;
  onSizeChange: (size: string | null) => void;
  className?: string;
}

export function VariantSelector({
  product,
  color,
  size,
  onColorChange,
  onSizeChange,
  className,
}: VariantSelectorProps) {
  const sizes = sizeOptions(product);
  const colors = colorOptions(product);

  return (
    <div className={cn('space-y-6', className)}>
      {colors.length > 0 ? (
        <fieldset>
          <legend className="mb-3 flex w-full items-baseline justify-between gap-3 text-xs uppercase tracking-widest text-kv-muted">
            <span>
              Colour{color ? <span className="ml-2 normal-case tracking-normal text-kv-silver">{color}</span> : null}
            </span>
          </legend>
          <div className="flex flex-wrap gap-2">
            {colors.map((option) => {
              const selected = option.label === color;
              return (
                <button
                  key={option.label}
                  type="button"
                  disabled={!option.inStock}
                  aria-pressed={selected}
                  onClick={() => onColorChange(option.label)}
                  className={cn(
                    'relative rounded-full border px-4 py-2 text-sm transition-all duration-300 ease-premium',
                    selected
                      ? 'border-kv-white bg-kv-white text-kv-bg'
                      : 'border-kv-line text-kv-silver hover:border-kv-lineStrong hover:text-kv-white',
                    !option.inStock && 'cursor-not-allowed border-kv-line/60 text-kv-dim line-through opacity-55',
                  )}
                >
                  {option.label}
                  {selected ? <Check className="ml-1.5 inline h-3 w-3" aria-hidden /> : null}
                </button>
              );
            })}
          </div>
        </fieldset>
      ) : null}

      {sizes.length > 0 ? (
        <fieldset>
          <legend className="mb-3 flex w-full items-baseline justify-between gap-3 text-xs uppercase tracking-widest text-kv-muted">
            <span>
              Size{size ? <span className="ml-2 normal-case tracking-normal text-kv-silver">{size}</span> : null}
            </span>
            <span className="text-2xs normal-case tracking-normal text-kv-dim">
              {color
                ? `${variantUnits(product, color, size)} available in ${color}`
                : 'Select a colour to check availability'}
            </span>
          </legend>
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
            {sizes.map((option) => {
              const units = color ? variantUnits(product, color, option.label) : option.units;
              const soldOut = units <= 0;
              const selected = option.label === size;
              return (
                <button
                  key={option.label}
                  type="button"
                  disabled={soldOut}
                  aria-pressed={selected}
                  onClick={() => onSizeChange(option.label)}
                  className={cn(
                    'relative flex flex-col items-center justify-center rounded-lg border py-2.5 text-sm transition-all duration-300 ease-premium',
                    selected
                      ? 'border-kv-white bg-kv-white text-kv-bg'
                      : 'border-kv-line text-kv-silver hover:border-kv-lineStrong hover:text-kv-white',
                    soldOut && 'cursor-not-allowed border-kv-line/50 text-kv-dim/60',
                    soldOut && 'after:absolute after:inset-x-2 after:top-1/2 after:h-px after:-translate-y-1/2 after:bg-kv-line',
                  )}
                >
                  <span className={cn(soldOut && 'line-through')}>{option.label}</span>
                  {!soldOut && color && units <= 3 ? (
                    <span
                      className={cn(
                        'mt-0.5 text-[0.5625rem] uppercase tracking-wider',
                        selected ? 'text-kv-bg/60' : 'text-kv-dim',
                      )}
                    >
                      {units} left
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>
        </fieldset>
      ) : null}
    </div>
  );
}
