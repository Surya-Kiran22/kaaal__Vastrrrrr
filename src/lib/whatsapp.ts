import { formatPrice } from './format';
import type { BusinessSettings, CartLine, CustomerDetails, DeliverySnapshot } from '@/types';

const LINE = '--------------------------------';

/**
 * The only line fields the message actually reads.
 *
 * `CartLine` satisfies this, and so do the lines the database stored. Typing the
 * parameter this way rather than as `CartLine[]` is what lets checkout build the
 * message from the saved order instead of from the cart — so if a price moved
 * while the customer was filling in the form, the store receives the figures
 * that were actually charged to the order, not the ones the browser remembered.
 */
export interface MessageLine {
  name: string;
  /** Printed in the message so the store can match it to the shelf label. */
  sku: string | null;
  color: string | null;
  size: string | null;
  quantity: number;
  unitPrice: number;
  compareAt: number | null;
}

export interface BuildOrderMessageInput {
  business: Pick<BusinessSettings, 'business_name' | 'whatsapp_number' | 'store_timings'> | null;
  lines: MessageLine[];
  totals: OrderTotals;
  customer: CustomerDetails;
  /** Server-assigned order reference, so the store can trace the message. */
  reference?: string | null;
  /** Frozen delivery address, so the message is self-contained. */
  delivery?: DeliverySnapshot | null;
}

/** Narrows a cart line to the fields the message needs. */
export function toMessageLines(lines: CartLine[]): MessageLine[] {
  return lines.map((line) => ({
    name: line.name,
    sku: line.sku,
    color: line.color,
    size: line.size,
    quantity: line.quantity,
    unitPrice: line.unitPrice,
    compareAt: line.compareAt,
  }));
}

export interface OrderTotals {
  itemCount: number;
  subtotal: number;
  savings: number;
  total: number;
}

/**
 * Derives the totals from a set of lines.
 *
 * Checkout uses this on the WhatsApp fallback path, where the lines have just
 * been re-read from the catalogue. The arithmetic deliberately matches
 * `cart-context.tsx` so a message built from database prices totals the same
 * way the cart did, and a savings figure can never be negative when a
 * `compare_at_price` sits below the selling price.
 */
export function computeMessageTotals(lines: MessageLine[]): OrderTotals {
  const subtotal = lines.reduce((sum, line) => sum + line.unitPrice * line.quantity, 0);
  const listTotal = lines.reduce(
    (sum, line) => sum + Math.max(line.compareAt ?? line.unitPrice, line.unitPrice) * line.quantity,
    0,
  );

  return {
    itemCount: lines.reduce((sum, line) => sum + line.quantity, 0),
    subtotal,
    savings: Math.max(0, Math.round(listTotal - subtotal)),
    total: subtotal,
  };
}

export function normaliseWhatsappNumber(value: string | null | undefined): string {
  if (!value) return '';
  // wa.me requires digits only. Drop the `+`, spaces, dashes and parentheses.
  return value.replace(/\D/g, '');
}

/** Renders a delivery snapshot as the lines a shopkeeper would read out. */
export function formatDeliveryAddress(delivery: DeliverySnapshot | null | undefined): string[] {
  if (!delivery) return [];
  const parts = [
    delivery.line1,
    delivery.line2,
    delivery.landmark ? `Near ${delivery.landmark}` : null,
    [delivery.city, delivery.state, delivery.pincode].filter(Boolean).join(' '),
  ].filter((part): part is string => Boolean(part && part.trim()));
  return parts.length > 0 ? parts : [];
}

export function buildOrderMessage({
  business,
  lines,
  totals,
  customer,
  reference,
  delivery,
}: BuildOrderMessageInput): string {
  const storeName = business?.business_name?.trim() || 'Kaal Vastr';

  const itemLines = lines.map((line, index) => {
    const color = line.color ? `Colour: ${line.color}` : null;
    const size = line.size ? `Size: ${line.size}` : null;
    const lineTotal = line.unitPrice * line.quantity;
    return [
      `${index + 1}. ${line.name}`,
      // `sku` is nullable in principle, so never print "SKU: null".
      ...(line.sku ? [`   SKU: ${line.sku}`] : []),
      // Colour and size are on their own lines because that is how the store
      // picks the item off the shelf; a single "Indigo / L" is easy to misread.
      ...(color ? [`   ${color}`] : []),
      ...(size ? [`   ${size}`] : []),
      `   Qty: ${line.quantity} x ${formatPrice(line.unitPrice)} = ${formatPrice(lineTotal)}`,
    ].join('\n');
  });

  const sections = [
    `*NEW ORDER — ${storeName.toUpperCase()}*`,
    LINE,
  ];

  if (reference) {
    // First thing after the header: the store can look the order up instantly.
    sections.push(`*Order ID:* ${reference}`);
  }

  sections.push(`*Customer:* ${customer.name.trim()}`);
  sections.push(`*Phone:* ${customer.phone.trim()}`);

  const addressLines = formatDeliveryAddress(delivery);
  if (addressLines.length > 0) {
    sections.push('*Deliver to:*', ...addressLines.map((line) => `   ${line}`));
  }

  if (customer.notes.trim()) {
    sections.push(`*Delivery notes:* ${customer.notes.trim()}`);
  }

  sections.push('', `*Items (${totals.itemCount}):*`, ...itemLines);
  sections.push('', `*Subtotal:* ${formatPrice(totals.subtotal)}`);

  if (totals.savings > 0) {
    sections.push(`*You save:* ${formatPrice(totals.savings)}`);
  }

  sections.push(`*Total to pay:* ${formatPrice(totals.total)}`);

  if (business?.store_timings) {
    sections.push(`*Store hours:* ${business.store_timings}`);
  }

  sections.push(
    LINE,
    'Please confirm availability, delivery address and payment details.',
    'Thank you for shopping with us.',
  );

  return sections.join('\n');
}

export interface WhatsappLinkResult {
  ok: boolean;
  url: string | null;
  reason?: 'missing-number' | 'empty-cart' | 'invalid-number';
}

export function buildWhatsappLink(input: BuildOrderMessageInput): WhatsappLinkResult {
  if (input.lines.length === 0) return { ok: false, url: null, reason: 'empty-cart' };

  const number = normaliseWhatsappNumber(input.business?.whatsapp_number);
  if (!number) return { ok: false, url: null, reason: 'missing-number' };
  if (number.length < 8) return { ok: false, url: null, reason: 'invalid-number' };

  const message = buildOrderMessage(input);
  return { ok: true, url: `https://wa.me/${number}?text=${encodeURIComponent(message)}` };
}

/** Plain-text chat link with no prefilled message (used for "Chat with us"). */
export function buildWhatsappChatLink(number: string | null | undefined): string | null {
  const clean = normaliseWhatsappNumber(number);
  return clean.length >= 8 ? `https://wa.me/${clean}` : null;
}

/** Short, human-quotable order reference, e.g. `KV-8F3K2Q`. */
export function createOrderReference(date = new Date()): string {
  const stamp = date.toISOString().slice(2, 10).replace(/-/g, '');
  const random = Math.random().toString(36).slice(2, 8).toUpperCase();
  return `KV-${stamp}-${random}`;
}

export type CopyResult = { ok: true } | { ok: false; reason: 'unsupported' | 'denied' };

/**
 * Copies text, falling back to a hidden textarea when the async Clipboard API
 * is unavailable.
 *
 * `navigator.clipboard` only exists in secure contexts, and some in-app browsers
 * and older mobile Safari reject the permission outright. Without the fallback
 * the customer would be left with no way to get the order to the store, which is
 * the only checkout path the shop has.
 */
export async function copyToClipboard(text: string): Promise<CopyResult> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return { ok: true };
    }
  } catch {
    // Fall through to the legacy path below.
  }

  if (typeof document === 'undefined') return { ok: false, reason: 'unsupported' };

  try {
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.top = '-1000px';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    const copied = document.execCommand('copy');
    document.body.removeChild(area);
    return copied ? { ok: true } : { ok: false, reason: 'denied' };
  } catch {
    return { ok: false, reason: 'unsupported' };
  }
}
