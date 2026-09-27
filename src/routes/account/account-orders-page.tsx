import { Link } from '@tanstack/react-router';
import { Package, PackageX, Phone, Truck } from 'lucide-react';
import { ErrorBoundary } from '@/components/ui/error-boundary';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState, ErrorState, Skeleton, toErrorMessage } from '@/components/ui/states';
import { useMyOrders, useRequestCancellation } from '@/hooks/useAccount';
import { formatDateTime, formatPrice } from '@/lib/format';
import { formatDeliveryAddress } from '@/lib/whatsapp';
import { cn } from '@/lib/utils';
import type { Order, OrderStatus } from '@/types';

const STATUS_TONE: Record<OrderStatus, 'neutral' | 'bright' | 'success' | 'warning' | 'danger'> = {
  placed: 'warning',
  contacted: 'neutral',
  dispatched: 'bright',
  delivered: 'success',
  cancelled: 'danger',
};

const STATUS_COPY: Record<OrderStatus, string> = {
  placed: 'Order received',
  contacted: 'Store in touch',
  dispatched: 'Out for delivery',
  delivered: 'Delivered',
  cancelled: 'Cancelled',
};

/** A customer may only ask to cancel while the order is still un-dispatched. */
function canRequestCancel(order: Order): boolean {
  return !order.cancel_requested && (order.status === 'placed' || order.status === 'contacted');
}

export function AccountOrdersPage() {
  const orders = useMyOrders();
  const requestCancel = useRequestCancellation();

  return (
    <div className="space-y-8">
      <div>
        <h2 className="font-display text-xl tracking-tight text-kv-white">Your orders</h2>
        <p className="mt-1 text-sm text-kv-muted">
          Placed orders and where they have got to. This updates on its own.
        </p>
      </div>

      <ErrorBoundary label="your orders" onRetry={() => void orders.refetch()}>
        {/*
          `isError` has to be tested before the empty state. A rejected query
          leaves `data` undefined, and "You have not placed an order yet" is
          exactly what a customer with five live orders must never be shown.
        */}
        {orders.isPending ? (
          <div className="space-y-4">
            {[0, 1].map((index) => (
              <Skeleton key={index} className="h-52 w-full rounded-2xl" />
            ))}
          </div>
        ) : orders.isError ? (
          <ErrorState
            title="Could not load your orders"
            message={toErrorMessage(orders.error)}
            onRetry={() => void orders.refetch()}
          />
        ) : orders.data && orders.data.length > 0 ? (
          // aria-live: these rows are fed by a realtime subscription, so a status
          // can move from "Placed" to "Dispatched" with no interaction. Without a
          // live region the change is visible but never announced.
          <ul className="space-y-4" aria-live="polite" aria-label="Your orders and their current status">
            {orders.data.map((order) => (
              <li key={order.id} className="rounded-2xl border border-kv-line bg-kv-card">
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-kv-line px-5 py-4">
                  <div>
                    <p className="font-mono text-xs text-kv-white">{order.reference}</p>
                    <p className="mt-1 text-2xs text-kv-dim">{formatDateTime(order.created_at)}</p>
                  </div>
                  <Badge tone={STATUS_TONE[order.status]}>{STATUS_COPY[order.status]}</Badge>
                </div>

                {order.cancel_requested && order.status !== 'cancelled' ? (
                  <p
                    role="status"
                    className="border-b border-kv-line bg-kv-warning/[0.06] px-5 py-2.5 text-2xs text-kv-warning"
                  >
                    Cancellation requested. The store will confirm with you on WhatsApp.
                  </p>
                ) : null}

                <div className="px-5 py-4">
                  <ul className="space-y-2.5">
                    {(order.items ?? []).map((item) => (
                      <li key={item.id} className="flex justify-between gap-4 text-xs">
                        <span className="min-w-0 text-kv-silver">
                          <span className="text-kv-white">{item.quantity}×</span> {item.name}
                          <span className="text-kv-dim">
                            {' '}
                            {[item.color, item.size].filter(Boolean).join(' / ')}
                          </span>
                        </span>
                        <span className="shrink-0 tabular-nums text-kv-white">
                          {formatPrice(item.line_total)}
                        </span>
                      </li>
                    ))}
                  </ul>

                  <div className="mt-4 flex items-center justify-between border-t border-kv-line pt-3">
                    <span className="text-2xs uppercase tracking-widest text-kv-dim">Total</span>
                    <span className="font-display text-base tabular-nums text-kv-white">
                      {formatPrice(order.total)}
                    </span>
                  </div>
                </div>

                {order.delivery || order.customer_phone ? (
                  <div className="grid gap-3 border-t border-kv-line px-5 py-4 text-2xs text-kv-muted sm:grid-cols-2">
                    <p className="flex items-start gap-2">
                      <Truck className="mt-px h-3.5 w-3.5 shrink-0 text-kv-dim" aria-hidden />
                      <span>{formatDeliveryAddress(order.delivery).join(', ') || 'Pickup at store'}</span>
                    </p>
                    <p className="flex items-center gap-2">
                      <Phone className="h-3.5 w-3.5 shrink-0 text-kv-dim" aria-hidden />
                      {order.customer_phone}
                    </p>
                  </div>
                ) : null}

                {canRequestCancel(order) ? (
                  <div className="flex flex-wrap items-center justify-between gap-3 border-t border-kv-line px-5 py-3">
                    <p className="text-2xs text-kv-dim">Changed your mind?</p>
                    <Button
                      variant="ghost"
                      size="sm"
                      className={cn('text-kv-danger hover:text-kv-danger')}
                      onClick={() => requestCancel.mutate(order.id)}
                      disabled={requestCancel.isPending}
                    >
                      <PackageX className="h-3.5 w-3.5" />
                      Request cancellation
                    </Button>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          // headingLevel 2: this is the first heading under the layout's h1, and
          // a hard-coded h3 would skip a level.
          <EmptyState
            headingLevel={2}
            icon={<Package className="h-6 w-6" aria-hidden />}
            title="No orders yet"
            description="When you order on WhatsApp, your order will appear here with its reference and status."
            action={
              <Button asChild>
                {/* Router Link, not <a href>: a raw anchor throws away the SPA and
                    reloads the whole app. */}
                <Link to="/shop">Browse the collection</Link>
              </Button>
            }
          />
        )}
      </ErrorBoundary>
    </div>
  );
}
