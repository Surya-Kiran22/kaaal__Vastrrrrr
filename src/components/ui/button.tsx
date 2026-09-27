import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { Loader2 } from 'lucide-react';
import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

const buttonVariants = cva(
  // 200ms rather than 300ms: this transition also carries the press feedback,
  // and a press that takes a third of a second to acknowledge the tap reads as
  // lag. Colour changes still look unhurried at this duration.
  // `ease-premium` is cubic-bezier(0.22, 1, 0.36, 1) — the same curve as
  // EASE_OUT_EXPO in lib/motion.ts, so CSS and framer-motion motion agree.
  'relative inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-full text-sm font-medium transition-all duration-200 ease-premium disabled:pointer-events-none disabled:opacity-45 active:scale-[0.97]',
  {
    variants: {
      variant: {
        primary:
          'bg-kv-white text-kv-bg hover:bg-kv-light shadow-[0_10px_30px_-14px_rgba(255,255,255,0.55)]',
        secondary:
          'border border-kv-line bg-kv-raised/60 text-kv-white hover:border-kv-lineStrong hover:bg-kv-hover',
        outline:
          'border border-kv-line text-kv-silver hover:border-kv-white/50 hover:text-kv-white hover:bg-kv-white/[0.04]',
        ghost: 'text-kv-silver hover:bg-kv-white/[0.06] hover:text-kv-white',
        danger:
          'border border-kv-danger/40 bg-kv-danger/10 text-kv-danger hover:bg-kv-danger/20 hover:border-kv-danger/70',
        whatsapp:
          'bg-[#25D366] text-[#052E16] hover:bg-[#31e57a] shadow-[0_10px_30px_-14px_rgba(37,211,102,0.7)]',
        link: 'text-kv-white underline-offset-4 hover:underline p-0 h-auto',
      },
      size: {
        sm: 'h-9 px-4 text-xs',
        md: 'h-11 px-6',
        lg: 'h-12 px-8 text-[0.9375rem]',
        icon: 'h-10 w-10',
        'icon-sm': 'h-9 w-9',
      },
      block: {
        true: 'w-full',
      },
    },
    defaultVariants: { variant: 'primary', size: 'md' },
  },
);

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
  loading?: boolean;
  loadingText?: string;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    className,
    variant,
    size,
    block,
    asChild = false,
    loading = false,
    loadingText,
    children,
    disabled,
    type = 'button',
    ...props
  },
  ref,
) {
  const Comp = asChild ? Slot : 'button';
  const isDisabled = disabled || loading;

  return (
    <Comp
      ref={ref}
      type={asChild ? undefined : type}
      className={cn(buttonVariants({ variant, size, block }), className)}
      disabled={asChild ? undefined : isDisabled}
      aria-busy={loading || undefined}
      {...props}
    >
      {loading ? (
        <>
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          <span>{loadingText ?? children}</span>
        </>
      ) : (
        children
      )}
    </Comp>
  );
});

export { buttonVariants };
