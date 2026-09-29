import { Link } from '@tanstack/react-router';
import { Clock, Facebook, Instagram, Mail, MapPin, MessageCircle, Phone } from 'lucide-react';
import { useBusinessSettings } from '@/hooks/useProducts';
import { WhatsAppGate } from '@/components/layout/whatsapp-gate';
import { Button } from '@/components/ui/button';

export function SiteFooter() {
  const { data: business, isPending } = useBusinessSettings();

  const addressLines = [business?.address, [business?.city, business?.state, business?.pincode].filter(Boolean).join(' ')]
    .filter(Boolean)
    .join(', ');

  const year = new Date().getFullYear();

  return (
    <footer className="mt-24 border-t border-kv-line bg-kv-surface/30">
      <div className="container-kv py-14 lg:py-20">
        <div className="grid gap-12 lg:grid-cols-[1.4fr_1fr_1fr]">
          {/* Brand ---------------------------------------------------------- */}
          <div className="max-w-sm">
            <div className="flex items-center gap-2.5">
              <span className="flex h-9 w-9 items-center justify-center rounded-lg border border-kv-line bg-kv-surface">
                <svg viewBox="0 0 24 24" className="h-4 w-4 text-kv-white" aria-hidden>
                  <path
                    d="M5 4v8.2C5 17 7.9 20 12 20s7-3 7-7.8V4"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.2"
                    strokeLinecap="round"
                  />
                </svg>
              </span>
              <span className="font-display text-lg tracking-[0.16em] text-kv-white">
                {business?.business_name ?? 'Kaal Vastr'}
              </span>
            </div>
            <p className="mt-5 text-sm leading-relaxed text-kv-muted">
              {isPending
                ? 'Loading store information…'
                : (business?.description ??
                  'Minimalist dark-grey and silver clothing, designed in Mumbai.')}
            </p>
            {business?.tagline ? (
              <p className="mt-4 text-2xs uppercase tracking-widest2 text-kv-dim">{business.tagline}</p>
            ) : null}

            {business?.whatsapp_number ? (
              <WhatsAppGate number={business.whatsapp_number} variant="whatsapp" className="mt-7">
                <MessageCircle className="h-4 w-4" />
                Order on WhatsApp
              </WhatsAppGate>
            ) : null}
          </div>

          {/* Shop ----------------------------------------------------------- */}
          <nav aria-label="Footer">
            <h3 className="eyebrow">Shop</h3>
            <ul className="mt-5 space-y-3 text-sm">
              {[
                { to: '/shop', label: 'All products' },
                { to: '/shop?category=Hoodies', label: 'Hoodies' },
                { to: '/shop?category=T-Shirts', label: 'T-Shirts' },
                { to: '/shop?category=Shirts', label: 'Shirts' },
                { to: '/shop?category=Jackets', label: 'Jackets' },
                { to: '/shop?category=Trousers', label: 'Trousers' },
                { to: '/contact', label: 'Store & contact' },
              ].map((link) => (
                <li key={link.label}>
                  <Link
                    to={link.to}
                    className="text-kv-muted transition-colors duration-300 hover:text-kv-white"
                  >
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>

          {/* Contact -------------------------------------------------------- */}
          <div>
            <h3 className="eyebrow">Visit the store</h3>
            <ul className="mt-5 space-y-4 text-sm text-kv-muted">
              <li className="flex gap-3">
                <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-kv-dim" aria-hidden />
                <span>{addressLines || 'Loading address…'}</span>
              </li>
              {business?.mobile_number ? (
                <li className="flex gap-3">
                  <Phone className="mt-0.5 h-4 w-4 shrink-0 text-kv-dim" aria-hidden />
                  <a
                    href={`tel:${business.mobile_number.replace(/\s/g, '')}`}
                    className="transition-colors hover:text-kv-white"
                  >
                    {business.mobile_number}
                  </a>
                </li>
              ) : null}
              {business?.email ? (
                <li className="flex gap-3">
                  <Mail className="mt-0.5 h-4 w-4 shrink-0 text-kv-dim" aria-hidden />
                  <a href={`mailto:${business.email}`} className="transition-colors hover:text-kv-white">
                    {business.email}
                  </a>
                </li>
              ) : null}
              {business?.store_timings ? (
                <li className="flex gap-3">
                  <Clock className="mt-0.5 h-4 w-4 shrink-0 text-kv-dim" aria-hidden />
                  <span>{business.store_timings}</span>
                </li>
              ) : null}
            </ul>

            {(business?.instagram_url || business?.facebook_url) && (
              <div className="mt-6 flex gap-2">
                {business.instagram_url ? (
                  <Button asChild variant="outline" size="icon-sm" aria-label="Kaal Vastr on Instagram">
                    <a href={business.instagram_url} target="_blank" rel="noopener noreferrer">
                      <Instagram className="h-4 w-4" />
                    </a>
                  </Button>
                ) : null}
                {business.facebook_url ? (
                  <Button asChild variant="outline" size="icon-sm" aria-label="Kaal Vastr on Facebook">
                    <a href={business.facebook_url} target="_blank" rel="noopener noreferrer">
                      <Facebook className="h-4 w-4" />
                    </a>
                  </Button>
                ) : null}
              </div>
            )}
          </div>
        </div>

        <div className="rule-silver my-10" />

        <div className="flex flex-col items-center justify-between gap-4 text-2xs uppercase tracking-widest text-kv-dim sm:flex-row">
          <p>
            © {year} {business?.business_name ?? 'Kaal Vastr'}. All rights reserved.
          </p>
          <div className="flex items-center gap-5">
            {business?.gst_number ? <span>GSTIN {business.gst_number}</span> : null}
            <Link to="/admin" className="transition-colors hover:text-kv-silver">
              Store Admin
            </Link>
          </div>
        </div>
      </div>
    </footer>
  );
}
