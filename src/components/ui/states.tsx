import { AlertTriangle, Inbox, Loader2, RefreshCw } from 'lucide-react';
import type { ReactNode } from 'react';
import { Button } from './button';
import { cn } from '@/lib/utils';

/**
 * A loading placeholder.
 *
 * `aria-hidden` because a shimmering box is meaningless read aloud, paired with
 * the `role="status"` label the parent renders. Without both, a screen reader
 * user gets no signal that a region is loading and nothing when it arrives.
 */
export function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div aria-hidden="true" className={cn('shimmer rounded-lg', className)} {...props} />;
}

/**
 * A visually hidden status line, for the "Loading…" that a bare `Skeleton`
 * cannot announce on its own.
 */
export function LoadingStatus({ children }: { children: ReactNode }) {
  return (
    <span role="status" className="sr-only">
      {children}
    </span>
  );
}

export function ProductCardSkeleton() {
  return (
    <div className="space-y-3">
      <Skeleton className="aspect-[3/4] w-full rounded-xl" />
      <Skeleton className="h-3 w-2/5" />
      <Skeleton className="h-3.5 w-4/5" />
      <Skeleton className="h-3 w-1/4" />
    </div>
  );
}

export function ProductGridSkeleton({ count = 8 }: { count?: number }) {
  return (
    <div className="grid grid-cols-2 gap-x-4 gap-y-9 sm:gap-x-5 lg:grid-cols-3 xl:grid-cols-4">
      {Array.from({ length: count }, (_, index) => (
        <ProductCardSkeleton key={index} />
      ))}
    </div>
  );
}

interface EmptyStateProps {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
  /**
   * These render directly under a layout's `h1` on several screens, where a
   * hard-coded `h3` skipped a level. Defaults to 3; pass 2 where the empty
   * state is the page's first heading.
   */
  headingLevel?: 2 | 3;
}

export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
  headingLevel = 3,
}: EmptyStateProps) {
  const Heading = headingLevel === 2 ? 'h2' : 'h3';
  return (
    <div
      // Announced when a list resolves to empty, which otherwise happens in
      // silence.
      role="status"
      // `animate-fade-up` rather than a framer-motion variant: this state swaps
      // in on every list query, and a CSS animation is cheaper than mounting a
      // motion component per render. index.css already collapses animation
      // duration under prefers-reduced-motion, so no JS guard is needed.
      className={cn(
        'animate-fade-up flex flex-col items-center justify-center rounded-2xl border border-dashed border-kv-line px-6 py-16 text-center',
        className,
      )}
    >
      <div className="mb-5 flex h-14 w-14 items-center justify-center rounded-full border border-kv-line bg-kv-surface text-kv-muted">
        {icon ?? <Inbox className="h-6 w-6" aria-hidden />}
      </div>
      <Heading className="font-display text-xl tracking-tight text-kv-white">{title}</Heading>
      {description ? (
        <p className="mt-2 max-w-sm text-sm leading-relaxed text-kv-muted">{description}</p>
      ) : null}
      {action ? <div className="mt-6">{action}</div> : null}
    </div>
  );
}

interface ErrorStateProps {
  title?: string;
  message?: string;
  onRetry?: () => void;
  className?: string;
  headingLevel?: 2 | 3;
}

export function ErrorState({
  title = 'Something went wrong',
  message,
  onRetry,
  className,
  headingLevel = 3,
}: ErrorStateProps) {
  const Heading = headingLevel === 2 ? 'h2' : 'h3';
  return (
    <div
      role="alert"
      className={cn(
        'animate-fade-up flex flex-col items-center justify-center rounded-2xl border border-kv-danger/25 bg-kv-danger/[0.06] px-6 py-12 text-center',
        className,
      )}
    >
      <div className="mb-5 flex h-14 w-14 items-center justify-center rounded-full border border-kv-danger/30 text-kv-danger">
        <AlertTriangle className="h-6 w-6" aria-hidden />
      </div>
      <Heading className="font-display text-xl tracking-tight text-kv-white">{title}</Heading>
      {message ? <p className="mt-2 max-w-md text-sm text-kv-muted">{message}</p> : null}
      {onRetry ? (
        <Button variant="outline" className="mt-6" onClick={onRetry}>
          <RefreshCw className="h-4 w-4" aria-hidden />
          Try again
        </Button>
      ) : null}
    </div>
  );
}

export function InlineSpinner({ className, label }: { className?: string; label?: string }) {
  return (
    <span role="status" className={cn('inline-flex items-center gap-2 text-sm text-kv-muted', className)}>
      <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
      {label}
    </span>
  );
}

/**
 * Turns any thrown value into a sentence a shopper can act on.
 * PostgREST errors arrive as `{ message, code, details, hint }`.
 */
export function toErrorMessage(error: unknown, fallback = 'Something went wrong.'): string {
  if (!error) return fallback;
  if (typeof error === 'string') return error;
  if (error instanceof Error && error.message) return error.message;

  if (typeof error === 'object' && 'message' in error) {
    const message = String((error as { message: unknown }).message);
    if (message) return message;
  }
  return fallback;
}
