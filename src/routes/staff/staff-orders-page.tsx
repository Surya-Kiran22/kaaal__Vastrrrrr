import { useMemo, useState } from 'react';
import { AlertTriangle, Check, MessageCircle, Package, Phone, Truck, X } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ErrorBoundary } from '@/components/ui/error-boundary';
import { EmptyState, ErrorState, Skeleton, toErrorMessage } from '@/components/ui/states';
import { useSetOrderStatus, useStaffOrders } from '@/hooks/useAccount';
import { useAuth } from '@/hooks/useAuth';
import { useBusinessSettings } from '@/hooks/useProducts';
import { formatDateTime, formatPrice } from '@/lib/format';
import { buildWhatsappChatLink, copyToClipboard, formatDeliveryAddress } from '@/lib/whatsapp';
import { cn } from '@/lib/utils';
import type { Order, OrderStatus } from '@/types';

const STATUS_TONE: Record<OrderStatus, 'neutral' | 'bright' | 'success' | 'warning' | 'danger'> = {
  placed: 'warning',
  contacted: 'neutral',
  dispatched: 'bright',
  delivered: 'success',
  cancelled: 'danger',
};

const FILTERS = ['all', 'placed', 'contacted', 'dispatched', 'delivered', 'cancelled'] as const;
type Filter = (typeof FILTERS)[number];

/** Mirrors the database's monotonic rule so the UI never offers a dead end. */
function nextStatuses(current: OrderStatus): OrderStatus[] {
  switch (current) {
    case 'placed':
      return ['contacted', 'cancelled'];
    case 'contacted':
      return ['dispatched', 'cancelled'];
    case 'dispatched':
      return ['delivered', 'cancelled'];
    default:
      return [];
  }
}

export function StaffOrdersPage() {
  const { isAdmin } = useAuth();
  const orders = useStaffOrders();
  const setStatus = useSetOrderStatus();
  const { data: business } = useBusinessSettings();
  const [filter, setFilter] = useState<Filter>('all');
  const [busyId, setBusyId] = useState<string | null>(null);

  const visible = useMemo(() => {
    const all = orders.data ?? [];
    const list = filter === 'all' ? all : all.filter((order) => order.status === filter);
    return [...list].sort((a, b) => b.created_at.localeCompare(a.created_at));
  }, [orders.data, filter]);

  // Staff only. An admin sees the same log with no controls, which matches the
  // database refusing admin updates anyway.
  const canUpdate = !isAdmin;

  const move = async (order: Order, status: OrderStatus) => {
    setBusyId(order.id);
    try {
      await setStatus.mutateAsync({ orderId: order.id, status });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not update that order.');
    } finally {
      setBusyId(null);
    }
  };

  const messageCustomer = async (order: Order) => {
    const text = `Hello ${order.customer_name}, regarding your Kaal Vastr order ${order.reference} (${formatDateTime(order.created_at)}).`;
    const link = buildWhatsappChatLink(business?.whatsapp_number);
    if (link) {
      window.open(`${link}?text=${encodeURIComponent(text)}`, '_blank', 'noopener,noreferrer');
      return;
    }
    const copied = await copyToClipboard(text);
    toast[copied.ok ? 'success' : 'error'](
      copied.ok ? 'Message copied' : 'Configure the store WhatsApp number to message customers.',
    );
  };

  return (
    <div className="space-y-6">
      {/* aria-pressed, because these are toggles whose state is otherwise
          carried by border colour alone -- the same treatment the admin product
          filters already have. */}
      <div
        role="group"
        aria-label="Filter orders by status"
        className="flex flex-wrap items-center gap-2"
      >
        {FILTERS.map((value) => {
          const count =
            value === 'all'
              ? (orders.data?.length ?? 0)
              : (orders.data?.filter((order) => order.status === value).length ?? 0);
          return (
            <button
              key={value}
              type="button"
              onClick={() => setFilter(value)}
              aria-pressed={filter === value}
              className={cn(
                'rounded-full border px-3.5 py-1.5 text-2xs uppercase tracking-widest transition-colors',
                filter === value
                  ? 'border-kv-white/30 bg-kv-surface text-kv-white'
                  : 'border-kv-line text-kv-dim hover:border-kv-lineStrong hover:text-kv-silver',
              )}
            >
              {value} <span className="ml-1 tabular-nums opacity-60">{count}</span>
            </button>
          );
        })}
      </div>

      {/*
        The log is the one region that must never fail quietly. Without an
        explicit error branch a rejected query leaves `data` undefined, the
        filter chips read zero, and the console confidently renders "No orders
        yet" -- which is indistinguishable from a genuinely empty day and would
        hide live orders from dispatch.
      */}
      <ErrorBoundary label="the orders log" onRetry={() => void orders.refetch()}>
        {orders.isPending ? (
          <div className="space-y-4">
            {[0, 1, 2].map((index) => (
              <Skeleton key={index} className="h-56 w-full rounded-2xl" />
            ))}
          </div>
        ) : orders.isError ? (
          <ErrorState
            title="Could not load the orders log"
            message={toErrorMessage(orders.error)}
            onRetry={() => void orders.refetch()}
          />
        ) : visible.length === 0 ? (
        <EmptyState
          headingLevel={2}
          icon={<Package className="h-6 w-6" aria-hidden />}
          title={filter === 'all' ? 'No orders yet' : `Nothing ${filter}`}
          description={
            filter === 'all'
              ? 'Customer orders will appear here the moment they are placed.'
              : 'Try a different filter to see the rest of the log.'
          }
        />
      ) : (
        // Realtime: a new order, or a status change on one already listed, both
        // arrive without a click. aria-live is what makes a screen reader
        // announce them rather than silently redraw.
        <ul className="space-y-4" aria-live="polite" aria-label="Orders and their dispatch status">
          {visible.map((order) => {
            const options = nextStatuses(order.status);
            const busy = busyId === order.id;

            return (
              <li key={order.id} className="rounded-2xl border border-kv-line bg-kv-card">
                <div className="flex flex-wrap items-start justify-between gap-3 border-b border-kv-line px-5 py-4">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-mono text-sm text-kv-white">{order.reference}</p>
                      <Badge tone={STATUS_TONE[order.status]}>{order.status}</Badge>
                      {order.cancel_requested ? (
                        <Badge tone="danger">
                          <AlertTriangle className="h-3 w-3" aria-hidden />
                          cancel requested
                        </Badge>
                      ) : null}
                    </div>
                    <p className="mt-1.5 text-2xs text-kv-dim">
                      {formatDateTime(order.created_at)}
                      {order.status_updated_at
                        ? ` · updated ${formatDateTime(order.status_updated_at)}`
                        : ''}
                    </p>
                  </div>

                  <div className="text-right">
                    <p className="font-display text-lg tabular-nums text-kv-white">
                      {formatPrice(order.total)}
                    </p>
                    <p className="text-2xs text-kv-dim">
                      {order.item_count} item{order.item_count === 1 ? '' : 's'}
                    </p>
                  </div>
                </div>

                <div className="grid gap-4 px-5 py-4 sm:grid-cols-2">
                  <div>
                    <p className="eyebrow mb-2">Customer</p>
                    <p className="text-xs text-kv-white">{order.customer_name}</p>
                    <p className="mt-1 flex items-center gap-1.5 text-2xs text-kv-muted">
                      <Phone className="h-3 w-3 text-kv-dim" aria-hidden />
                      {order.customer_phone}
                    </p>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="mt-2"
                      onClick={() => void messageCustomer(order)}
                    >
                      <MessageCircle className="h-3.5 w-3.5" />
                      Message
                    </Button>
                  </div>

                  <div>
                    <p className="eyebrow mb-2">Deliver to</p>
                    <p className="flex items-start gap-1.5 text-2xs leading-relaxed text-kv-muted">
                      <Truck className="mt-px h-3.5 w-3.5 shrink-0 text-kv-dim" aria-hidden />
                      <span>
                        {formatDeliveryAddress(order.delivery).join(', ') || 'Pickup at store'}
                      </span>
                    </p>
                    {order.notes ? (
                      <p className="mt-2 text-2xs italic text-kv-dim">“{order.notes}”</p>
                    ) : null}
                  </div>
                </div>

                <ul className="space-y-1.5 border-t border-kv-line px-5 py-4">
                  {(order.items ?? []).map((item) => (
                    <li key={item.id} className="flex justify-between gap-4 text-xs">
                      <span className="min-w-0 text-kv-silver">
                        <span className="text-kv-white">{item.quantity}×</span> {item.name}
                        <span className="text-kv-dim">
                          {' '}
                          {[item.color, item.size].filter(Boolean).join(' / ')}
                        </span>
                        {item.sku ? <span className="text-kv-dim"> · {item.sku}</span> : null}
                      </span>
                      <span className="shrink-0 tabular-nums text-kv-white">
                        {formatPrice(item.line_total)}
                      </span>
                    </li>
                  ))}
                </ul>

                {canUpdate ? (
                  <div className="flex flex-wrap items-center gap-2 border-t border-kv-line px-5 py-3">
                    {options.length === 0 ? (
                      <p className="text-2xs text-kv-dim">
                        This order is {order.status}. No further changes are possible.
                      </p>
                    ) : (
                      <>
                        <span className="mr-1 text-2xs uppercase tracking-widest text-kv-dim">
                          Move to
                        </span>
                        {options.map((status) => (
                          <Button
                            key={status}
                            variant={status === 'cancelled' ? 'ghost' : 'secondary'}
                            size="sm"
                            onClick={() => void move(order, status)}
                            disabled={busy}
                            className={cn(status === 'cancelled' && 'text-kv-danger hover:text-kv-danger')}
                          >
                            {status === 'cancelled' ? (
                              <X className="h-3.5 w-3.5" />
                            ) : (
                              <Check className="h-3.5 w-3.5" />
                            )}
                            {status}
                          </Button>
                        ))}
                      </>
                    )}
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
        )}
      </ErrorBoundary>
    </div>
  );
}
