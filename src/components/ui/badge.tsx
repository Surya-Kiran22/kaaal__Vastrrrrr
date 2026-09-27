import * as LabelPrimitive from '@radix-ui/react-label';
import { cva, type VariantProps } from 'class-variance-authority';
import { forwardRef, type HTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

const badgeVariants = cva(
  'inline-flex items-center gap-1 rounded-full border font-medium uppercase tracking-wider transition-colors',
  {
    variants: {
      tone: {
        neutral: 'border-kv-line bg-kv-raised text-kv-silver',
        bright: 'border-kv-white/25 bg-kv-white text-kv-bg',
        success: 'border-kv-success/30 bg-kv-success/10 text-kv-success',
        warning: 'border-kv-warning/30 bg-kv-warning/10 text-kv-warning',
        danger: 'border-kv-danger/30 bg-kv-danger/10 text-kv-danger',
      },
      size: {
        sm: 'px-2 py-0.5 text-2xs',
        md: 'px-2.5 py-1 text-2xs',
      },
    },
    defaultVariants: { tone: 'neutral', size: 'sm' },
  },
);

export interface BadgeProps
  extends HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

export function Badge({ className, tone, size, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ tone, size }), className)} {...props} />;
}

const { Root: LabelRoot } = LabelPrimitive;

export const Label = forwardRef<
  React.ElementRef<typeof LabelPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof LabelPrimitive.Root>
>(function Label({ className, ...props }, ref) {
  return (
    <LabelRoot
      ref={ref}
      className={cn(
        'text-xs font-medium tracking-wide text-kv-silver peer-disabled:cursor-not-allowed peer-disabled:opacity-70',
        className,
      )}
      {...props}
    />
  );
});

export { badgeVariants };
