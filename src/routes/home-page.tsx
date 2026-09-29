import { Link } from '@tanstack/react-router';
import { motion, useReducedMotion } from 'framer-motion';
import { ArrowRight, MessageCircle, ShieldCheck, Sparkles, Truck } from 'lucide-react';
import { ProductCard } from '@/components/product/product-card';
import { ProductSlideshow } from '@/components/product/product-slideshow';
import { Button } from '@/components/ui/button';
import { ProductGridSkeleton } from '@/components/ui/states';
import { Reveal } from '@/components/ui/reveal';
import { useBusinessSettings, useCategories, useProducts } from '@/hooks/useProducts';
import { buildWhatsappChatLink } from '@/lib/whatsapp';

const PILLARS = [
  {
    icon: ShieldCheck,
    title: 'No middlemen',
    body: 'Straight from our Khar West studio to your door. The price you see is the price you pay.',
  },
  {
    icon: Sparkles,
    title: 'Small-batch drops',
    body: 'Limited runs, no restocks. When a colourway is gone, it is genuinely gone.',
  },
  {
    icon: Truck,
    title: 'Same-city delivery',
    body: 'Pick up from the store or get it couriered across India. Confirmation happens on WhatsApp.',
  },
] as const;

export function HomePage() {
  const { data: business } = useBusinessSettings();
  const { data: categories = [], isPending: categoriesPending } = useCategories();
  const { data: featured = [], isPending: featuredPending, isError: featuredError } = useProducts({
    featuredOnly: true,
  });
  const { data: newest = [], isPending: newestPending } = useProducts({ sort: 'newest' });

  const reduceMotion = useReducedMotion();
  const whatsapp = buildWhatsappChatLink(business?.whatsapp_number);

  // Fall back to the newest arrivals if nothing is flagged as featured.
  const showcase = (featured.length > 0 ? featured : newest).slice(0, 8);
  const showcasePending = featured.length > 0 ? featuredPending : newestPending;

  /*
   * The slideshow is built from the same pool but filtered on `inStock`, which
   * `toStoreProduct` computes from variant stock rather than the raw `stock`
   * column. Filtering on the column would advertise size-and-colour
   * combinations that are individually sold out.
   */
  const inStockShowcase = showcase.filter((product) => product.inStock).slice(0, 8);

  const heroImage =
    business?.hero_image_url ??
    'https://images.unsplash.com/photo-1523381210434-271e8be1f52b?auto=format&fit=crop&w=1920&q=80';

  return (
    <>
      {/* ------------------------------------------------------------------ */}
      {/* Hero                                                               */}
      {/* ------------------------------------------------------------------ */}
      <section className="relative overflow-hidden border-b border-kv-line">
        <div className="absolute inset-0">
          <img
            src={heroImage}
            alt=""
            aria-hidden
            className="h-full w-full object-cover opacity-[0.22]"
            fetchPriority="high"
          />
          <div className="absolute inset-0 bg-gradient-to-b from-kv-bg/70 via-kv-bg/85 to-kv-bg" />
          <div className="absolute inset-0 bg-gradient-to-r from-kv-bg via-kv-bg/60 to-transparent" />
        </div>

        <div className="container-kv relative py-24 sm:py-32 lg:py-40">
          <div className="max-w-2xl">
            <motion.p
              initial={reduceMotion ? false : { opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
              className="eyebrow"
            >
              {business?.tagline ?? 'Dark by design'}
            </motion.p>

            <motion.h1
              initial={reduceMotion ? false : { opacity: 0, y: 18 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.7, delay: 0.08, ease: [0.22, 1, 0.36, 1] }}
              className="heading-display mt-6 text-balance"
            >
              Clothing for people who prefer{' '}
              <span className="text-kv-silver">less, but better.</span>
            </motion.h1>

            <motion.p
              initial={reduceMotion ? false : { opacity: 0, y: 18 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.7, delay: 0.16, ease: [0.22, 1, 0.36, 1] }}
              className="mt-7 max-w-lg text-pretty text-base leading-relaxed text-kv-muted sm:text-lg"
            >
              {business?.description ??
                'Minimalist dark-grey and silver clothing, designed in Mumbai. Heavyweight staples, sharp silhouettes, monochrome essentials.'}
            </motion.p>

            <motion.div
              initial={reduceMotion ? false : { opacity: 0, y: 18 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.7, delay: 0.24, ease: [0.22, 1, 0.36, 1] }}
              className="mt-10 flex flex-wrap items-center gap-3"
            >
              <Button asChild size="lg">
                <Link to="/shop">
                  Shop the collection
                  <ArrowRight className="h-4 w-4" />
                </Link>
              </Button>
              {whatsapp ? (
                <Button asChild variant="outline" size="lg">
                  <a href={whatsapp} target="_blank" rel="noopener noreferrer">
                    <MessageCircle className="h-4 w-4" />
                    Talk to us
                  </a>
                </Button>
              ) : null}
            </motion.div>

            <motion.dl
              initial={reduceMotion ? false : { opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.8, delay: 0.4 }}
              className="mt-14 grid max-w-lg grid-cols-3 gap-6 border-t border-kv-line pt-7"
            >
              {[
                { label: 'GSM weight', value: '240–450' },
                { label: 'Drops per year', value: '06' },
                { label: 'Payment', value: 'On delivery' },
              ].map((stat) => (
                <div key={stat.label}>
                  <dt className="text-2xs uppercase tracking-widest text-kv-dim">{stat.label}</dt>
                  <dd className="mt-1.5 font-display text-lg text-kv-white">{stat.value}</dd>
                </div>
              ))}
            </motion.dl>
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------------------ */}
      {/* Categories                                                         */}
      {/* ------------------------------------------------------------------ */}
      {!categoriesPending && categories.length > 0 ? (
        <section className="border-b border-kv-line">
          <div className="container-kv py-10">
            <div className="flex flex-wrap items-center gap-2.5">
              <span className="eyebrow mr-1">Shop by</span>
              <Link
                to="/shop"
                className="rounded-full border border-kv-line px-4 py-1.5 text-xs text-kv-silver transition-all duration-300 ease-premium hover:border-kv-white/50 hover:text-kv-white"
              >
                All
              </Link>
              {categories.map((category) => (
                <Link
                  key={category}
                  to="/shop"
                  search={{ category }}
                  className="rounded-full border border-kv-line px-4 py-1.5 text-xs text-kv-silver transition-all duration-300 ease-premium hover:border-kv-white/50 hover:text-kv-white"
                >
                  {category}
                </Link>
              ))}
            </div>
          </div>
        </section>
      ) : null}

      {/* ------------------------------------------------------------------ */}
      {/* In-stock slideshow                                                  */}
      {/* ------------------------------------------------------------------ */}
      {!showcasePending && inStockShowcase.length > 0 ? (
        <ProductSlideshow products={inStockShowcase} />
      ) : null}

      {/* ------------------------------------------------------------------ */}
      {/* Featured / newest                                                  */}
      {/* ------------------------------------------------------------------ */}
      <section className="container-kv py-20 lg:py-28">
        <Reveal className="mb-10 flex flex-wrap items-end justify-between gap-5">
          <div>
            <p className="eyebrow">{featured.length > 0 ? 'This season' : 'Latest arrivals'}</p>
            <h2 className="mt-3 font-display text-3xl tracking-tight text-kv-white sm:text-4xl">
              {featured.length > 0 ? 'Featured pieces' : 'New in the studio'}
            </h2>
          </div>
          <Button asChild variant="ghost" size="sm">
            <Link to="/shop">
              View all
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </Button>
        </Reveal>

        {showcasePending ? (
          <ProductGridSkeleton count={4} />
        ) : featuredError ? (
          <p className="rounded-xl border border-kv-danger/25 bg-kv-danger/[0.06] px-5 py-8 text-center text-sm text-kv-danger">
            We could not load the collection right now. Please refresh or check your connection.
          </p>
        ) : showcase.length === 0 ? (
          <p className="rounded-xl border border-dashed border-kv-line px-5 py-16 text-center text-sm text-kv-muted">
            No products are published yet. Add them from the store admin to see them here.
          </p>
        ) : (
          <div className="grid grid-cols-2 gap-x-4 gap-y-10 sm:gap-x-5 lg:grid-cols-4">
            {showcase.map((product, index) => (
              <ProductCard key={product.id} product={product} index={index} priority={index < 4} />
            ))}
          </div>
        )}
      </section>

      {/* ------------------------------------------------------------------ */}
      {/* Pillars                                                            */}
      {/* ------------------------------------------------------------------ */}
      <section className="border-y border-kv-line bg-kv-surface/25">
        <div className="container-kv py-20 lg:py-24">
          <div className="grid gap-10 md:grid-cols-3 md:gap-8">
            {PILLARS.map((pillar, index) => (
              <Reveal key={pillar.title} delay={index * 0.08}>
                <div className="edge-light rounded-2xl border border-kv-line bg-kv-card p-7">
                  <pillar.icon className="h-5 w-5 text-kv-silver" aria-hidden />
                  <h3 className="mt-5 font-display text-xl tracking-tight text-kv-white">{pillar.title}</h3>
                  <p className="mt-2.5 text-sm leading-relaxed text-kv-muted">{pillar.body}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------------------ */}
      {/* Store CTA                                                          */}
      {/* ------------------------------------------------------------------ */}
      <section className="container-kv py-20 lg:py-28">
        <Reveal>
          <div className="relative overflow-hidden rounded-2xl border border-kv-line bg-kv-card px-7 py-14 text-center sm:px-14">
            <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-kv-white/25 to-transparent" />
            <p className="eyebrow">Two taps to order</p>
            <h2 className="mx-auto mt-4 max-w-2xl font-display text-3xl tracking-tight text-kv-white sm:text-4xl">
              Pick your size, and we finish the order on WhatsApp
            </h2>
            <p className="mx-auto mt-5 max-w-xl text-pretty text-sm leading-relaxed text-kv-muted sm:text-base">
              No online payment, no card forms. We build a clear order summary with your items and totals, then
              hand you straight to our WhatsApp so you can confirm delivery and payment with a real person.
            </p>
            <div className="mt-9 flex flex-wrap items-center justify-center gap-3">
              <Button asChild size="lg">
                <Link to="/shop">
                  Start browsing
                  <ArrowRight className="h-4 w-4" />
                </Link>
              </Button>
              <Button asChild variant="outline" size="lg">
                <Link to="/contact">Store details</Link>
              </Button>
            </div>
          </div>
        </Reveal>
      </section>
    </>
  );
}
