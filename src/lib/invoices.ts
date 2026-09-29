import { supabase } from '@/lib/supabase';

export interface InvoiceItem {
  name: string;
  sku: string | null;
  image: string | null;
  color: string | null;
  size: string | null;
  quantity: number;
  unit_price: number | string;
  line_total: number | string;
}

/**
 * The exact shape returned by the `get_invoice_by_token` RPC. Numeric columns
 * arrive as strings over PostgREST; coerce through formatPrice() when showing.
 */
export interface PublicInvoice {
  order_id: string;
  reference: string;
  status: string;
  placed_at: string;
  customer: string;
  phone: string;
  subtotal: number | string;
  savings: number | string;
  total: number | string;
  item_count: number;
  notes: string | null;
  items: InvoiceItem[];
}

const INVOICE_QUERY_KEY = 'public-invoice';

export function publicInvoiceQueryKey(token: string): readonly unknown[] {
  return [INVOICE_QUERY_KEY, token];
}

/**
 * Public single-invoice lookup by share token. Returns null for an unknown or
 * revoked token rather than throwing, so the UI can show "not found" state.
 */
export async function fetchInvoiceByToken(token: string): Promise<PublicInvoice | null> {
  const { data, error } = await supabase.rpc('get_invoice_by_token', { _token: token });
  if (error) throw new Error(error.message);
  const rows = Array.isArray(data) ? data : [];
  return (rows[0] ?? null) as PublicInvoice | null;
}

/**
 * Console-only: mint (or return the existing) share token for one order.
 */
export async function issueInvoiceToken(orderId: string): Promise<string> {
  const { data, error } = await supabase.rpc('issue_invoice_token', { _order_id: orderId });
  if (error) throw new Error(error.message);
  if (typeof data !== 'string' || !data) throw new Error('Could not create an invoice link.');
  return data;
}

/**
 * Console-only: unpublish an order's invoice link.
 */
export async function revokeInvoiceToken(orderId: string): Promise<void> {
  const { error } = await supabase.rpc('revoke_invoice_token', { _order_id: orderId });
  if (error) throw new Error(error.message);
}

/** `orderId` + `token` -> absolute shareable URL for the public invoice page. */
export function invoiceUrlFor(token: string): string {
  return `${window.location.origin}/invoice/${token}`;
}