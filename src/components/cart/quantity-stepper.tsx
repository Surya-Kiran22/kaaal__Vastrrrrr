import { Minus, Plus } from 'lucide-react';
import { cn } from '@/lib/utils';

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
          'flex items-center justify-center rounded-full text-kv-muted transition-colors duration-200 hover:text-kv-white disabled:pointer-events-none disabled:opacity-30',
        )}
      >
        <Minus className="h-3.5 w-3.5" />
      </button>
      <span
        aria-live="polite"
        className={cn(
          'min-w-[2.25rem] text-center text-sm font-medium tabular-nums text-kv-white',
          size === 'sm' && 'min-w-[2rem] text-xs',
        )}
      >
        {value}
      </span>
      <button
        type="button"
        onClick={() => onChange(value + 1)}
        disabled={atMax}
        aria-label={`Increase ${label.toLowerCase()}`}
        className={cn(
          box,
          'flex items-center justify-center rounded-full text-kv-muted transition-colors duration-200 hover:text-kv-white disabled:pointer-events-none disabled:opacity-30',
        )}
      >
        <Plus className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
