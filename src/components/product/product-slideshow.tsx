import { Link } from '@tanstack/react-router';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { ArrowLeft, ArrowRight } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { DURATION, EASE_OUT_EXPO, RISE_DISTANCE } from '@/lib/motion';
import type { StoreProduct } from '@/types';
import { cn } from '@/lib/utils';

/** Long enough to read a product name, short enough not to strand anyone. */
const SLIDE_INTERVAL_MS = 6000;

export interface ProductSlideshowProps {
  /** Already filtered to in-stock products by the caller. */
  products: StoreProduct[];
  className?: string;
}

/**
 * Auto-advancing in-stock showcase for the home page.
 *
 * Three details matter more than the animation:
 *
 *   - The timer pauses on hover, on focus and while the tab is hidden. A
 *     carousel that keeps cycling under a pointer resting on a product is
 *     actively hostile, and a background tab burning a timer is just waste.
 *   - It is a real region with previous/next controls and dot buttons, so it is
 *     operable from the keyboard and does not depend on autoplay to advance.
 *   - Only `opacity` and a small `x` offset are animated. Animating a slide's
 *     width or position would reflow the whole section on every frame.
 *
 * Under `prefers-reduced-motion` the slide change becomes an instant cut and
 * autoplay stops, since motion is the thing being opted out of.
 */
export function ProductSlideshow({ products, className }: ProductSlideshowProps) {
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const reduceMotion = useReducedMotion();
  const sectionRef = useRef<HTMLElement>(null);

  // A shrinking product list (last item sells out mid-view) must not leave the
  // index pointing past the end.
  const count = products.length;
  const safeIndex = count > 0 ? Math.min(index, count - 1) : 0;

  const go = useCallback(
    (next: number) => {
      if (count === 0) return;
      setIndex(((next % count) + count) % count);
    },
    [count],
  );

  // Pause while the tab is in the background, without a separate listener per
  // slide: a hidden tab has nothing to show and the interval is pure waste.
  useEffect(() => {
    const onVisibility = () => setPaused(document.hidden);
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);

  useEffect(() => {
    if (reduceMotion || paused || count < 2) return;

    const timer = window.setInterval(() => {
      setIndex((current) => ((current + 1) % count));
    }, SLIDE_INTERVAL_MS);

    return () => window.clearInterval(timer);
  }, [count, paused, reduceMotion]);

  if (count === 0) return null;

  const current = products[safeIndex];
  const previous = products[(safeIndex - 1 + count) % count];

  return (
    <section
      ref={sectionRef}
      aria-roledescription="carousel"
      aria-label="Pieces available right now"
      // Hover/focus-within pauses, so a pointer resting on a product does not
      // have it swapped out from under it.
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocusCapture={() => setPaused(true)}
      onBlurCapture={() => setPaused(false)}
      className={cn('relative overflow-hidden border-y border-kv-line bg-kv-surface/25', className)}
    >
      <div className="container-kv py-16 lg:py-24">
        <div className="mb-8 flex flex-wrap items-end justify-between gap-5">
          <div>
            <p className="eyebrow">In stock now</p>
            <h2 className="mt-3 font-display text-3xl tracking-tight text-kv-white sm:text-4xl">
              Ready to ship
            </h2>
          </div>

          {count > 1 ? (
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="icon"
                onClick={() => go(safeIndex - 1)}
                aria-label="Previous product"
              >
                <ArrowLeft className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => go(safeIndex + 1)}
                aria-label="Next product"
              >
                <ArrowRight className="h-4 w-4" />
              </Button>
            </div>
          ) : null}
        </div>

        <div className="relative">
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={current.id}
              initial={reduceMotion ? { opacity: 1 } : { opacity: 0, x: RISE_DISTANCE * 2 }}
              animate={{ opacity: 1, x: 0 }}
              exit={reduceMotion ? { opacity: 1 } : { opacity: 0, x: -RISE_DISTANCE * 2 }}
              transition={{ duration: DURATION.slow, ease: EASE_OUT_EXPO }}
            >
              <Link
                to="/product/$slug"
                params={{ slug: current.slug }}
                className="group grid items-center gap-8 lg:grid-cols-[1.1fr_1fr]"
              >
                <div className="relative aspect-[4/5] overflow-hidden rounded-2xl border border-kv-line bg-kv-card sm:aspect-[16/10] lg:aspect-[4/3]">
                  {current.primaryImage ? (
                    <img
                      src={current.primaryImage}
                      alt={current.name}
                      loading="lazy"
                      className="h-full w-full object-cover transition-transform duration-700 ease-premium group-hover:scale-[1.04]"
                    />
                  ) : (
                    <div className="h-full w-full bg-gradient-to-br from-kv-card to-kv-surface" />
                  )}
                </div>

                <div className="min-w-0">
                  <p className="eyebrow">{current.category || 'In stock'}</p>
                  <h3 className="mt-3 font-display text-3xl tracking-tight text-kv-white sm:text-4xl">
                    {current.name}
                  </h3>
                  {current.description ? (
                    <p className="mt-4 line-clamp-3 text-sm leading-relaxed text-kv-muted">
                      {current.description}
                    </p>
                  ) : null}

                  <div className="mt-6 flex flex-wrap items-center gap-4">
                    <span className="text-lg text-kv-white">₹{current.price.toLocaleString('en-IN')}</span>
                    {current.compareAt ? (
                      <span className="text-sm text-kv-dim line-through">
                        ₹{current.compareAt.toLocaleString('en-IN')}
                      </span>
                    ) : null}
                    <span className="rounded-full border border-kv-line px-3 py-1 text-2xs uppercase tracking-widest text-kv-silver">
                      {current.totalStock} in stock
                    </span>
                  </div>

                  <span className="mt-7 inline-flex items-center gap-2 text-xs uppercase tracking-widest text-kv-white transition-colors group-hover:text-kv-silver">
                    View this piece
                    <ArrowRight
                      className="h-3.5 w-3.5 transition-transform duration-300 ease-premium group-hover:translate-x-1"
                      aria-hidden
                    />
                  </span>
                </div>
              </Link>
            </motion.div>
          </AnimatePresence>
        </div>

        {count > 1 ? (
          <div className="mt-8 flex items-center gap-2.5" role="tablist" aria-label="Choose a product">
            {products.map((product, slideIndex) => (
              <button
                key={product.id}
                type="button"
                role="tab"
                aria-selected={slideIndex === safeIndex}
                aria-label={`Show ${product.name}`}
                onClick={() => go(slideIndex)}
                className={cn(
                  'h-1 rounded-full transition-all duration-300 ease-premium',
                  slideIndex === safeIndex
                    ? 'w-10 bg-kv-white'
                    : 'w-5 bg-kv-line hover:bg-kv-lineStrong',
                )}
              />
            ))}
            <span className="ml-2 text-2xs uppercase tracking-widest text-kv-dim">
              {previous.name} → {current.name}
            </span>
          </div>
        ) : null}
      </div>
    </section>
  );
}
