import { Link, useParams } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, CalendarDays, Link2, Receipt, ShieldCheck } from 'lucide-react';
import { ErrorState, Skeleton, toErrorMessage } from '@/components/ui/states';
import { useBusinessSettings } from '@/hooks/useProducts';
import { formatDateTime, formatPrice } from '@/lib/format';
import { fetchInvoiceByToken, publicInvoiceQueryKey } from '@/lib/invoices';
import { copyToClipboard } from '@/lib/whatsapp';
import { toast } from 'sonner';

const STATUS_LABELS: Record<string, string> = {
  placed: 'Placed',
  contacted: 'Contacted',
  dispatched: 'Dispatched',
  delivered: 'Delivered',
  cancelled: 'Cancelled',
  sent_to_whatsapp: 'Sent to WhatsApp',
};

const STATUS_TONES: Record<string, string> = {
  placed: 'bg-kv-white/10 text-kv-white',
  contacted: 'bg-kv-warning/15 text-kv-warning',
  dispatched: 'bg-kv-success/15 text-kv-success',
  delivered: 'bg-kv-success/15 text-kv-success',
  cancelled: 'bg-kv-danger/15 text-kv-danger',
  sent_to_whatsapp: 'bg-kv-muted/20 text-kv-silver',
};

function StatusBadge({ status }: { status: string }) {
  const label = STATUS_LABELS[status] ?? status;
  const tone = STATUS_TONES[status] ?? 'bg-kv-white/10 text-kv-white';
  return (
    <span className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-2xs uppercase tracking-widest ${tone}`}>
      {label}
    </span>
  );
}

function SheetSkeleton() {
  return (
    <div className="invoice-sheet space-y-6 rounded-xl border border-kv-line bg-kv-surface p-6 sm:p-10">
      <div className="flex items-start justify-between gap-4">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-5 w-24" />
      </div>
      <Skeleton className="h-14 w-full" />
      <div className="h-px w-full bg-kv-line" />
      <Skeleton className="h-12 w-48" />
      <div className="space-y-3">
        {[0, 1, 2, 3].map((index) => (
          <Skeleton key={index} className="h-5 w-full" />
        ))}
      </div>
      <div className="ml-auto h-16 w-40" />
    </div>
  );
}

export function InvoiceTokenPage() {
  const { token } = useParams({ from: '/invoice/$token' });
  const { data: business } = useBusinessSettings();
  const invoice = useQuery({
    queryKey: publicInvoiceQueryKey(token),
    queryFn: () => fetchInvoiceByToken(token),
    staleTime: 60_000,
  });

  const handleCopy = async () => {
    await copyToClipboard(window.location.href);
    toast.success('Invoice link copied');
  };

  return (
    <div className="invoice-page container-kv py-12 sm:py-16">
      <div className="mx-auto max-w-2xl">
        <div className="no-print mb-6 flex flex-wrap items-center justify-between gap-3">
          <Link
            to="/"
            className="inline-flex items-center gap-2 text-2xs uppercase tracking-widest text-kv-muted transition-colors hover:text-kv-white"
          >
            <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
            Back to store
          </Link>
          {invoice.data ? (
            <button
              type="button"
              onClick={() => void handleCopy()}
              className="inline-flex items-center gap-2 rounded-md border border-kv-line bg-kv-card px-3 py-1.5 text-2xs uppercase tracking-widest text-kv-silver transition-colors hover:border-kv-white/40 hover:text-kv-white"
            >
              <Link2 className="h-3.5 w-3.5" aria-hidden />
              Copy link
            </button>
          ) : null}
        </div>

        {invoice.isPending ? (
          <SheetSkeleton />
        ) : invoice.isError ? (
          <ErrorState
            title="Could not load this invoice"
            message={toErrorMessage(invoice.error)}
            onRetry={() => void invoice.refetch()}
          />
        ) : !invoice.data ? (
          <div className="invoice-sheet rounded-xl border border-kv-line bg-kv-surface p-10 text-center">
            <Receipt className="mx-auto h-8 w-8 text-kv-dim" aria-hidden />
            <h1 className="mt-4 font-display text-3xl text-kv-white">Invoice not found</h1>
            <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-kv-muted">
              This link is invalid or has been revoked by the store. If you need a copy,
              ask the store for a fresh one.
            </p>
          </div>
        ) : (
          <div className="invoice-sheet overflow-hidden rounded-xl border border-kv-line bg-kv-surface">
            {/* Header ------------------------------------------------------- */}
            <div className="flex flex-wrap items-start justify-between gap-4 border-b border-kv-line bg-kv-card/60 px-6 py-6 sm:px-10">
              <div>
                <p className="font-display text-2xl tracking-[0.02em] text-kv-white">
                  {business?.business_name ?? 'Kaal Vastr'}
                </p>
                {[business?.address, business?.city, business?.pincode]
                  .filter(Boolean)
                  .join(', ') ? (
                  <p className="mt-1 text-2xs text-kv-muted">
                    {[business?.address, business?.city, business?.state, business?.pincode]
                      .filter(Boolean)
                      .join(', ')}
                  </p>
                ) : null}
              </div>
              <div className="text-right">
                <p className="flex items-center justify-end gap-2 text-2xs uppercase tracking-widest text-kv-dim">
                  <Receipt className="h-3.5 w-3.5" aria-hidden />
                  Invoice
                </p>
                <p className="mt-1 font-mono text-sm text-kv-white">{invoice.data.reference}</p>
                <p className="mt-2">
                  <StatusBadge status={invoice.data.status} />
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-4 px-6 py-5 sm:px-10">
              <div className="min-w-0">
                <p className="eyebrow mb-1.5">Billed to</p>
                <p className="text-sm text-kv-white">{invoice.data.customer || 'Customer'}</p>
                <p className="mt-0.5 text-2xs text-kv-muted">{invoice.data.phone}</p>
              </div>
              <p className="flex items-center gap-1.5 text-2xs text-kv-muted">
                <CalendarDays className="h-3.5 w-3.5 text-kv-dim" aria-hidden />
                {formatDateTime(invoice.data.placed_at)}
              </p>
            </div>

            {/* Items -------------------------------------------------------- */}
            <table className="w-full text-sm">
              <thead>
                <tr className="border-y border-kv-line text-left text-2xs uppercase tracking-widest text-kv-dim">
                  <th className="px-6 py-3 font-medium sm:px-10">Item</th>
                  <th className="px-3 py-3 text-right font-medium">Qty</th>
                  <th className="px-3 py-3 text-right font-medium">Rate</th>
                  <th className="px-6 py-3 text-right font-medium sm:px-10">Amount</th>
                </tr>
              </thead>
              <tbody>
                {(invoice.data.items ?? []).map((item, index) => (
                  <tr key={`${item.name}-${item.size}-${index}`} className="border-b border-kv-line/60">
                    <td className="px-6 py-3 sm:px-10">
                      <p className="text-kv-white">{item.name}</p>
                      <p className="mt-0.5 text-2xs text-kv-dim">
                        {[item.color, item.size].filter(Boolean).join(' / ') || '—'}
                        {item.sku ? ` · ${item.sku}` : ''}
                      </p>
                    </td>
                    <td className="px-3 py-3 text-right tabular-nums text-kv-silver">
                      {item.quantity}
                    </td>
                    <td className="px-3 py-3 text-right tabular-nums text-kv-silver">
                      {formatPrice(item.unit_price)}
                    </td>
                    <td className="px-6 py-3 text-right tabular-nums text-kv-white sm:px-10">
                      {formatPrice(item.line_total)}
                    </td>
                  </tr>
                ))}
                {!invoice.data.items?.length ? (
                  <tr>
                    <td className="px-6 py-6 text-center text-xs text-kv-muted sm:px-10">
                      No line items on record.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>

            {/* Totals ------------------------------------------------------- */}
            <div className="flex justify-end px-6 py-5 sm:px-10">
              <dl className="w-full max-w-[15rem] space-y-2 text-sm">
                <div className="flex justify-between gap-6">
                  <dt className="text-kv-muted">Subtotal</dt>
                  <dd className="tabular-nums text-kv-silver">{formatPrice(invoice.data.subtotal)}</dd>
                </div>
                <div className="flex justify-between gap-6">
                  <dt className="text-kv-muted">Savings</dt>
                  <dd className="tabular-nums text-kv-success">−{formatPrice(invoice.data.savings)}</dd>
                </div>
                <div className="flex justify-between gap-6 border-t border-kv-line pt-2">
                  <dt className="font-medium text-kv-white">Total</dt>
                  <dd className="tabular-nums font-medium text-kv-white">
                    {formatPrice(invoice.data.total)}
                  </dd>
                </div>
              </dl>
            </div>

            {invoice.data.notes ? (
              <p className="border-t border-kv-line px-6 py-4 text-2xs italic leading-relaxed text-kv-dim sm:px-10">
                “{invoice.data.notes}”
              </p>
            ) : null}

            <p className="flex items-center justify-center gap-2 border-t border-kv-line px-6 py-5 text-2xs text-kv-muted sm:px-10">
              <ShieldCheck className="h-3.5 w-3.5 text-kv-dim" aria-hidden />
              Thanks for shopping with {business?.business_name ?? 'Kaal Vastr'}.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}