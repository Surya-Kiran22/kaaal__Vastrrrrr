import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Minus, Plus, Trash2 } from 'lucide-react';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { ErrorState, toErrorMessage } from '@/components/ui/states';
import { useUpdateVariantStock } from '@/hooks/useAdminMutations';
import { zeroesOutAvailability } from '@/lib/products';
import { cn } from '@/lib/utils';
import type { StoreProduct, VariantStock } from '@/types';

interface DraftRow {
  colour: string;
  size: string;
  units: string;
}

function toRows(stock: VariantStock | null): DraftRow[] {
  const entries = Object.entries(stock ?? {});
  if (entries.length === 0) return [];
  return entries
    .map(([key, units]) => {
      const [colour = '', size = ''] = key.split('|');
      return { colour, size, units: String(units) };
    })
    .sort((a, b) =>
      `${a.colour}|${a.size}`.localeCompare(`${b.colour}|${b.size}`),
    );
}

function toVariantStock(rows: DraftRow[]): VariantStock {
  const cleaned: VariantStock = {};
  for (const row of rows) {
    const colour = row.colour.trim();
    const size = row.size.trim();
    if (!colour || !size) continue;
    // A blank or unparseable cell means "leave this variant alone", so it is
    // dropped rather than written as zero.
    const units = Number.parseInt(row.units, 10);
    if (!Number.isFinite(units)) continue;
    cleaned[`${colour}|${size}`] = Math.max(0, units);
  }
  return cleaned;
}

function totalOf(stock: VariantStock): number {
  return Object.values(stock).reduce((sum, units) => sum + units, 0);
}

/**
 * Order-insensitive equality. The rows are sorted for display while the jsonb
 * column keeps its own key order, so a plain JSON.stringify comparison would
 * report a change on every open and leave Save enabled for nothing.
 */
function sameStock(a: VariantStock, b: VariantStock): boolean {
  const keysA = Object.keys(a).sort();
  const keysB = Object.keys(b).sort();
  if (keysA.length !== keysB.length) return false;
  return keysA.every((key, index) => key === keysB[index] && a[key] === b[key]);
}

export function StockAdjustDialog({
  product,
  open,
  onOpenChange,
}: {
  product: StoreProduct | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [rows, setRows] = useState<DraftRow[]>([]);
  const saveStock = useUpdateVariantStock();

  // Re-seed from the product each time it opens. Seeding on `product` alone would
  // not fire when the same product is reopened after a save, because the row
  // identity has not changed.
  useEffect(() => {
    if (open && product) {
      setRows(toRows(product.variant_stock));
      saveStock.reset();
    }
    // `saveStock` is a stable mutation object; depending on it would re-seed and
    // wipe the admin's in-progress edits.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, product?.id, product?.variant_stock]);

  const next = useMemo(() => toVariantStock(rows), [rows]);
  const currentTotal = product?.totalStock ?? 0;
  const nextTotal = totalOf(next);
  const delta = nextTotal - currentTotal;
  const willUnpublish = zeroesOutAvailability(next);
  // An empty map is never saved: the sync trigger reads an empty object as
  // "not variant tracked" and would silently fall back to the flat stock count.
  const dirty = Object.keys(next).length > 0 && !sameStock(next, product?.variant_stock ?? {});

  const patch = (index: number, change: Partial<DraftRow>) => {
    setRows((previous) =>
      previous.map((row, position) => (position === index ? { ...row, ...change } : row)),
    );
  };

  const bump = (index: number, by: number) => {
    const row = rows[index];
    if (!row) return;
    const base = Number.parseInt(row.units, 10);
    const current = Number.isFinite(base) ? base : 0;
    patch(index, { units: String(Math.max(0, current + by)) });
  };

  const addRow = () => {
    setRows((previous) => [...previous, { colour: '', size: '', units: '0' }]);
  };

  const removeRow = (index: number) => {
    setRows((previous) => previous.filter((_, position) => position !== index));
  };

  const submit = async () => {
    if (!product) return;
    try {
      await saveStock.mutateAsync({ id: product.id, variantStock: next });
      onOpenChange(false);
    } catch {
      // Reported inline below; the toast alone disappears too fast to act on.
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen && saveStock.isPending) return;
        onOpenChange(nextOpen);
      }}
    >
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Adjust stock</DialogTitle>
          <DialogDescription>
            {product
              ? `${product.name}${product.sku ? ` · ${product.sku}` : ''}. Units are stored per colour and size, and the storefront sells straight from these numbers.`
              : 'Units are stored per colour and size.'}
          </DialogDescription>
        </DialogHeader>

        <DialogBody>
          {saveStock.isError ? (
            <ErrorState
              title="Could not save stock"
              message={toErrorMessage(saveStock.error)}
              onRetry={() => void submit()}
            />
          ) : rows.length === 0 ? (
            <div className="rounded-lg border border-dashed border-kv-line bg-kv-card/40 px-4 py-8 text-center">
              <p className="text-sm text-kv-white">No colour/size variants are tracked</p>
              <p className="mt-1 text-2xs text-kv-muted">
                This product falls back to a single flat stock count. Add a row to start tracking
                variants instead.
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              <div className="grid grid-cols-[1fr_1fr_auto_auto] gap-2 px-1 text-2xs uppercase tracking-widest text-kv-dim">
                <span>Colour</span>
                <span>Size</span>
                <span className="w-24 text-center">Units</span>
                <span className="w-8" />
              </div>

              {rows.map((row, index) => (
                <div key={index} className="grid grid-cols-[1fr_1fr_auto_auto] items-center gap-2">
                  <input
                    value={row.colour}
                    onChange={(event) => patch(index, { colour: event.target.value })}
                    placeholder="Black"
                    aria-label={`Colour for variant ${index + 1}`}
                    className="rounded-lg border border-kv-line bg-kv-card px-3 py-2 text-sm text-kv-white outline-none transition-colors placeholder:text-kv-dim focus:border-kv-white/40"
                  />
                  <input
                    value={row.size}
                    onChange={(event) => patch(index, { size: event.target.value })}
                    placeholder="M"
                    aria-label={`Size for variant ${index + 1}`}
                    className="rounded-lg border border-kv-line bg-kv-card px-3 py-2 text-sm text-kv-white outline-none transition-colors placeholder:text-kv-dim focus:border-kv-white/40"
                  />
                  <div className="flex w-24 items-center justify-between rounded-lg border border-kv-line bg-kv-card">
                    <button
                      type="button"
                      onClick={() => bump(index, -1)}
                      aria-label={`Decrease ${row.colour || row.size || 'variant'} stock`}
                      className="px-2 py-2 text-kv-muted transition-colors hover:text-kv-white"
                    >
                      <Minus className="h-3.5 w-3.5" aria-hidden />
                    </button>
                    <input
                      value={row.units}
                      onChange={(event) => patch(index, { units: event.target.value })}
                      inputMode="numeric"
                      aria-label={`Units for ${row.colour || row.size || 'variant'}`}
                      className="w-10 bg-transparent py-2 text-center font-money text-sm tabular-nums text-kv-white outline-none"
                    />
                    <button
                      type="button"
                      onClick={() => bump(index, 1)}
                      aria-label={`Increase ${row.colour || row.size || 'variant'} stock`}
                      className="px-2 py-2 text-kv-muted transition-colors hover:text-kv-white"
                    >
                      <Plus className="h-3.5 w-3.5" aria-hidden />
                    </button>
                  </div>
                  <button
                    type="button"
                    onClick={() => removeRow(index)}
                    aria-label={`Remove ${row.colour || row.size || 'variant'} from tracking`}
                    className="rounded-md p-2 text-kv-dim transition-colors hover:text-kv-danger"
                  >
                    <Trash2 className="h-3.5 w-3.5" aria-hidden />
                  </button>
                </div>
              ))}

              <Button type="button" variant="ghost" onClick={addRow} className="w-full">
                Add variant
              </Button>
            </div>
          )}

          <div className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-kv-line bg-kv-raised/30 px-3 py-2.5">
            <span className="text-2xs uppercase tracking-widest text-kv-muted">Total on hand</span>
            <span
              className={cn(
                'font-money text-sm tabular-nums',
                delta === 0 ? 'text-kv-muted' : delta > 0 ? 'text-kv-success' : 'text-kv-warning',
              )}
            >
              {currentStockLabel(currentTotal, nextTotal, delta)}
            </span>
          </div>

          {willUnpublish ? (
            <p className="mt-3 flex items-start gap-2 rounded-lg border border-kv-warning/30 bg-kv-warning/[0.08] px-3 py-2.5 text-2xs text-kv-warning">
              <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden />
              <span>
                Saving zero units everywhere also marks this product unavailable on the storefront.
                Stock alone will not bring it back — re-publish it from the product form afterwards.
              </span>
            </p>
          ) : null}
        </DialogBody>

        <DialogFooter>
          <Button
            type="button"
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={saveStock.isPending}
          >
            Cancel
          </Button>
          <Button type="button" onClick={() => void submit()} disabled={!dirty || saveStock.isPending}>
            {saveStock.isPending ? 'Saving…' : 'Save stock'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function currentStockLabel(current: number, next: number, delta: number): string {
  if (delta === 0) return `${current}`;
  const sign = delta > 0 ? '+' : '−';
  return `${current} → ${next} (${sign}${Math.abs(delta)})`;
}
