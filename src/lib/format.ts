const inrFormatter = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  maximumFractionDigits: 0,
});

const inrPreciseFormatter = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** `4499` -> `₹4,499`. Prices in the catalogue are whole rupees. */
export function formatPrice(value: number | string | null | undefined): string {
  const amount = Number(value ?? 0);
  if (!Number.isFinite(amount)) return inrFormatter.format(0);
  return Number.isInteger(amount) ? inrFormatter.format(amount) : inrPreciseFormatter.format(amount);
}

export function formatNumber(value: number | string | null | undefined): string {
  const amount = Number(value ?? 0);
  return new Intl.NumberFormat('en-IN').format(Number.isFinite(amount) ? amount : 0);
}

export function discountPercent(
  selling: number | string | null | undefined,
  compareAt: number | string | null | undefined,
): number | null {
  const s = Number(selling ?? 0);
  const c = Number(compareAt ?? 0);
  if (!Number.isFinite(s) || !Number.isFinite(c) || c <= 0 || c <= s) return null;
  return Math.round(((c - s) / c) * 100);
}

export function formatRelativeDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }).format(
    date,
  );
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
}
