import { motion } from 'framer-motion';
import {
  Clock,
  Facebook,
  Instagram,
  Mail,
  MapPin,
  MessageCircle,
  Phone,
  Receipt,
  ShieldCheck,
  Truck,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Reveal } from '@/components/ui/reveal';
import { InlineSpinner } from '@/components/ui/states';
import { useBusinessSettings } from '@/hooks/useProducts';
import { buildWhatsappChatLink } from '@/lib/whatsapp';

const FAQS = [
  {
    q: 'How do I place an order?',
    a: 'Add your pieces and sizes to the cart, then choose “Order on WhatsApp”. We build a message with your items, quantities and total, and WhatsApp opens with it ready to send. Our team confirms availability, delivery and payment with you directly.',
  },
  {
    q: 'Do you take payment on this website?',
    a: 'No. This site never asks for card or UPI details. Payment is settled directly with the store, in person or by the method our team confirms on WhatsApp.',
  },
  {
    q: 'Can I collect from the store?',
    a: 'Yes. Choose store pickup in the WhatsApp conversation and we will keep your pieces aside at the counter for 24 hours.',
  },
  {
    q: 'What if my size sells out?',
    a: 'Every card shows live availability. If a piece sells out after you added it, we will tell you on WhatsApp and offer the closest available option or a full refund of the amount you paid.',
  },
  {
    q: 'Do you exchange unworn pieces?',
    a: 'Yes, within 7 days of delivery, with tags intact. Message us on WhatsApp and we will arrange a pickup or exchange at the store.',
  },
];

export function ContactPage() {
  const { data: business, isPending, isError } = useBusinessSettings();
  const whatsapp = buildWhatsappChatLink(business?.whatsapp_number);

  const addressLines = [
    business?.address,
    [business?.city, business?.state, business?.pincode].filter(Boolean).join(' '),
  ]
    .filter(Boolean)
    .join(', ');

  const mapsQuery = encodeURIComponent(
    [business?.address, business?.city, business?.state, business?.pincode].filter(Boolean).join(', '),
  );

  return (
    <div className="pb-10">
      {/* Hero ----------------------------------------------------------- */}
      <section className="border-b border-kv-line">
        <div className="container-kv py-20 lg:py-24">
          <motion.div
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.55, ease: [0.22, 1, 0.36, 1] }}
            className="max-w-2xl"
          >
            <p className="eyebrow">Store & contact</p>
            <h1 className="heading-display mt-4">Come by, or just message us</h1>
            <p className="mt-6 text-pretty text-base leading-relaxed text-kv-muted sm:text-lg">
              {business?.description ??
                'Find us in Khar West, or skip the trip entirely — the fastest way to order is WhatsApp.'}
            </p>
          </motion.div>
        </div>
      </section>

      {/* Contact grid ---------------------------------------------------- */}
      <section className="container-kv py-16 lg:py-20">
        {isPending ? (
          <InlineSpinner label="Loading store information…" />
        ) : isError ? (
          <p className="rounded-xl border border-kv-danger/25 bg-kv-danger/[0.06] px-5 py-6 text-sm text-kv-danger">
            Store information is unavailable right now. Please try again shortly.
          </p>
        ) : (
          <div className="grid gap-8 lg:grid-cols-3">
            <Reveal className="lg:col-span-2">
              <div className="grid gap-4 sm:grid-cols-2">
                <InfoCard icon={MapPin} title="Store address">
                  <p className="leading-relaxed">{addressLines || 'Address to be confirmed'}</p>
                  {mapsQuery ? (
                    <a
                      href={`https://www.google.com/maps/search/?api=1&query=${mapsQuery}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-3 inline-block text-2xs uppercase tracking-widest text-kv-silver underline-offset-4 hover:underline"
                    >
                      Open in Maps
                    </a>
                  ) : null}
                </InfoCard>

                <InfoCard icon={Clock} title="Store timings">
                  <p className="leading-relaxed">{business?.store_timings ?? 'Timings to be confirmed'}</p>
                  <p className="mt-3 text-2xs text-kv-dim">
                    Closed on public holidays unless stated otherwise.
                  </p>
                </InfoCard>

                <InfoCard icon={MessageCircle} title="WhatsApp orders">
                  <p className="leading-relaxed">
                    {business?.whatsapp_number
                      ? `+${business.whatsapp_number}`
                      : 'Number to be confirmed'}
                  </p>
                  {whatsapp ? (
                    <Button asChild variant="whatsapp" size="sm" className="mt-4">
                      <a href={whatsapp} target="_blank" rel="noopener noreferrer">
                        <MessageCircle className="h-3.5 w-3.5" />
                        Start a chat
                      </a>
                    </Button>
                  ) : null}
                </InfoCard>

                <InfoCard icon={Phone} title="Call the store">
                  {business?.mobile_number ? (
                    <>
                      <a
                        href={`tel:${business.mobile_number.replace(/\s/g, '')}`}
                        className="leading-relaxed transition-colors hover:text-kv-white"
                      >
                        {business.mobile_number}
                      </a>
                      <p className="mt-3 text-2xs text-kv-dim">
                        Best for stock checks and restock dates.
                      </p>
                    </>
                  ) : (
                    <p className="text-kv-dim">Number to be confirmed</p>
                  )}
                </InfoCard>

                {business?.email ? (
                  <InfoCard icon={Mail} title="Email">
                    <a
                      href={`mailto:${business.email}`}
                      className="leading-relaxed transition-colors hover:text-kv-white"
                    >
                      {business.email}
                    </a>
                    <p className="mt-3 text-2xs text-kv-dim">We reply within one working day.</p>
                  </InfoCard>
                ) : null}

                {business?.gst_number || business?.upi_id ? (
                  <InfoCard icon={Receipt} title="Business details">
                    <dl className="space-y-2 text-sm">
                      {business?.gst_number ? (
                        <div>
                          <dt className="text-2xs uppercase tracking-widest text-kv-dim">GSTIN</dt>
                          <dd className="mt-0.5 tabular-nums text-kv-silver">{business.gst_number}</dd>
                        </div>
                      ) : null}
                      {business?.upi_id ? (
                        <div>
                          <dt className="text-2xs uppercase tracking-widest text-kv-dim">UPI ID</dt>
                          <dd className="mt-0.5 tabular-nums text-kv-silver">{business.upi_id}</dd>
                        </div>
                      ) : null}
                    </dl>
                  </InfoCard>
                ) : null}
              </div>

              {business?.instagram_url || business?.facebook_url ? (
                <div className="mt-6 flex flex-wrap items-center gap-3">
                  <span className="eyebrow">Follow</span>
                  {business.instagram_url ? (
                    <Button asChild variant="outline" size="sm">
                      <a href={business.instagram_url} target="_blank" rel="noopener noreferrer">
                        <Instagram className="h-3.5 w-3.5" />
                        Instagram
                      </a>
                    </Button>
                  ) : null}
                  {business.facebook_url ? (
                    <Button asChild variant="outline" size="sm">
                      <a href={business.facebook_url} target="_blank" rel="noopener noreferrer">
                        <Facebook className="h-3.5 w-3.5" />
                        Facebook
                      </a>
                    </Button>
                  ) : null}
                </div>
              ) : null}
            </Reveal>

            {/* Ordering explainer --------------------------------------- */}
            <Reveal delay={0.1}>
              <aside className="edge-light h-full rounded-2xl border border-kv-line bg-kv-card p-7">
                <p className="eyebrow">How ordering works</p>
                <ol className="mt-6 space-y-5">
                  {[
                    'Add your pieces and choose a size.',
                    'Review quantities and the total in your cart.',
                    'Enter your name and mobile number.',
                    'Send the prepared order on WhatsApp.',
                    'We confirm stock, delivery and payment with you.',
                  ].map((step, index) => (
                    <li key={step} className="flex gap-4">
                      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-kv-line text-2xs text-kv-silver">
                        {index + 1}
                      </span>
                      <span className="pt-1 text-sm leading-relaxed text-kv-muted">{step}</span>
                    </li>
                  ))}
                </ol>

                <div className="mt-8 space-y-3 border-t border-kv-line pt-6">
                  <p className="flex items-start gap-2.5 text-2xs leading-relaxed text-kv-dim">
                    <ShieldCheck className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden />
                    This website never collects card or UPI details. Payment is agreed directly with the store.
                  </p>
                  <p className="flex items-start gap-2.5 text-2xs leading-relaxed text-kv-dim">
                    <Truck className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden />
                    Mumbai orders usually dispatch within 24 hours. Other pincodes 2–4 working days.
                  </p>
                </div>
              </aside>
            </Reveal>
          </div>
        )}
      </section>

      {/* FAQ ------------------------------------------------------------ */}
      <section className="border-t border-kv-line bg-kv-surface/25">
        <div className="container-kv py-16 lg:py-24">
          <Reveal>
            <p className="eyebrow">Good to know</p>
            <h2 className="mt-3 font-display text-3xl tracking-tight text-kv-white sm:text-4xl">
              Frequently asked
            </h2>
          </Reveal>
          <div className="mt-10 grid gap-4 md:grid-cols-2">
            {FAQS.map((faq, index) => (
              <Reveal key={faq.q} delay={index * 0.05}>
                <details className="group h-full rounded-xl border border-kv-line bg-kv-card px-6 py-5 transition-colors duration-300 open:border-kv-lineStrong">
                  <summary className="cursor-pointer list-none text-sm font-medium text-kv-white marker:hidden">
                    <span className="flex items-start justify-between gap-4">
                      {faq.q}
                      <span
                        className="mt-0.5 shrink-0 text-kv-dim transition-transform duration-300 group-open:rotate-45"
                        aria-hidden
                      >
                        +
                      </span>
                    </span>
                  </summary>
                  <p className="mt-3.5 text-sm leading-relaxed text-kv-muted">{faq.a}</p>
                </details>
              </Reveal>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}

function InfoCard({
  icon: Icon,
  title,
  children,
}: {
  icon: typeof MapPin;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-kv-line bg-kv-card p-6">
      <div className="flex items-center gap-2.5">
        <Icon className="h-4 w-4 text-kv-silver" aria-hidden />
        <h3 className="text-xs uppercase tracking-widest text-kv-muted">{title}</h3>
      </div>
      <div className="mt-4 text-sm text-kv-silver">{children}</div>
    </div>
  );
}
