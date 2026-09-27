import { Minus, Plus } from 'lucide-react';
import { motion, useReducedMotion } from 'framer-motion';
import { cn } from '@/lib/utils';
import { DURATION, EASE_OUT_EXPO } from '@/lib/motion';

interface QuantityStepperProps {
  value: number;
  min?: number;
  max: number;
  onChange: (value: number) => void;
  className?: string;
  size?: 'sm' | 'md';
  label?: string;
}

export function QuantityStepper({
  value,
  min = 1,
  max,
  onChange,
  className,
  size = 'md',
  label = 'Quantity',
}: QuantityStepperProps) {
  const atMin = value <= min;
  const atMax = value >= max;
  const reduceMotion = useReducedMotion();
  const box = size === 'sm' ? 'h-8 w-8' : 'h-10 w-10';

  return (
    <div
      className={cn(
        'inline-flex items-center rounded-full border border-kv-line bg-kv-surface',
        className,
      )}
    >
      <button
        type="button"
        onClick={() => onChange(value - 1)}
        disabled={atMin}
        aria-label={`Decrease ${label.toLowerCase()}`}
        className={cn(
          box,
          'flex items-center justify-center rounded-full text-kv-muted transition-all duration-200 ease-premium hover:text-kv-white active:scale-90 disabled:pointer-events-none disabled:opacity-30',
        )}
      >
        <Minus className="h-3.5 w-3.5" />
      </button>
      {/*
        The `aria-live` node is the outer span and never remounts, so every
        quantity change is still announced. The animated element is a child
        keyed on `value` - remounting that is what replays the bump. Putting the
        key on the live region instead would tear down the region on each
        change, which is the classic way to make an aria-live announcement
        silently stop working.
      */}
      <span
        aria-live="polite"
        className={cn(
          'min-w-[2.25rem] text-center text-sm font-medium tabular-nums text-kv-white',
          size === 'sm' && 'min-w-[2rem] text-xs',
        )}
      >
        <motion.span
          key={value}
          className="inline-block"
          initial={reduceMotion ? false : { scale: 0.8, opacity: 0.5 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ duration: DURATION.base, ease: EASE_OUT_EXPO }}
        >
          {value}
        </motion.span>
      </span>
      <button
        type="button"
        onClick={() => onChange(value + 1)}
        disabled={atMax}
        aria-label={`Increase ${label.toLowerCase()}`}
        className={cn(
          box,
          'flex items-center justify-center rounded-full text-kv-muted transition-all duration-200 ease-premium hover:text-kv-white active:scale-90 disabled:pointer-events-none disabled:opacity-30',
        )}
      >
        <Plus className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
