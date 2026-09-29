import { AnimatePresence } from 'framer-motion';
import { MessageCircle, ShoppingBag, Trash2 } from 'lucide-react';
import { useCart } from '@/features/cart/cart-context';
import { useCartDrawer } from '@/features/cart/cart-drawer-context';
import { useBusinessSettings } from '@/hooks/useProducts';
import { useAuth } from '@/hooks/useAuth';
import { useOrderGate } from '@/hooks/useOrderGate';
import { formatPrice } from '@/lib/format';
import { CartLineItem } from './cart-line-item';
import { WhatsAppCheckoutDialog } from './whatsapp-checkout-dialog';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/states';
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';

export function CartDrawer() {
  const { isOpen, close, isCheckoutOpen, openCheckout, closeCheckout } = useCartDrawer();
  const { lines, totals, isEmpty, setQuantity, removeItem, clearCart } = useCart();
  const { data: business } = useBusinessSettings();
  const { canShop } = useAuth();
  const { requireCustomer, requestSignIn } = useOrderGate();

  return (
    <>
      <Sheet open={isOpen} onOpenChange={(open) => !open && close()}>
        <SheetContent side="right" className="flex">
          <SheetHeader>
            <div className="flex items-center justify-between gap-4">
              <SheetTitle>
                Your cart
                {totals.itemCount > 0 ? (
                  <span className="ml-2 text-sm font-normal text-kv-muted">
                    {totals.itemCount} item{totals.itemCount === 1 ? '' : 's'}
                  </span>
                ) : null}
              </SheetTitle>
              {!isEmpty ? (
                <button
                  type="button"
                  onClick={clearCart}
                  className="flex items-center gap-1.5 text-2xs uppercase tracking-widest text-kv-dim transition-colors hover:text-kv-danger"
                >
                  <Trash2 className="h-3 w-3" />
                  Clear
                </button>
              ) : null}
            </div>
          </SheetHeader>

          {isEmpty ? (
            <SheetBody className="flex flex-col justify-center p-5">
              <EmptyState
                icon={<ShoppingBag className="h-6 w-6" />}
                title={canShop ? 'Your cart is empty' : 'Sign in to start a cart'}
                description={
                  canShop
                    ? 'Browse the collection and add a piece you like. Your cart is saved on this device.'
                    : 'Browsing is open to everyone, but a cart, your addresses and your order history live in your account. Sign in, add a piece, then order on WhatsApp from here.'
                }
                action={
                  canShop ? (
                    <Button asChild variant="primary" onClick={close}>
                      <a href="/shop">Start shopping</a>
                    </Button>
                  ) : (
                    <Button variant="primary" onClick={requestSignIn}>
                      Sign in
                    </Button>
                  )
                }
              />
            </SheetBody>
          ) : (
            <>
              <SheetBody>
                <ul className="divide-y divide-kv-line px-5">
                  <AnimatePresence initial={false} mode="popLayout">
                    {lines.map((line) => (
                      <CartLineItem
                        key={line.id}
                        line={line}
                        onQuantityChange={setQuantity}
                        onRemove={removeItem}
                        compact
                      />
                    ))}
                  </AnimatePresence>
                </ul>
              </SheetBody>

              <SheetFooter className="space-y-4">
                <dl className="space-y-1.5 text-sm">
                  <div className="flex justify-between text-kv-muted">
                    <dt>Subtotal</dt>
                    <dd className="tabular-nums">{formatPrice(totals.subtotal)}</dd>
                  </div>
                  {totals.savings > 0 ? (
                    <div className="flex justify-between text-kv-success">
                      <dt>You save</dt>
                      <dd className="tabular-nums">-{formatPrice(totals.savings)}</dd>
                    </div>
                  ) : null}
                  <div className="flex items-baseline justify-between border-t border-kv-line pt-3">
                    <dt className="text-xs uppercase tracking-widest text-kv-muted">Total</dt>
                    <dd className="font-display text-2xl tabular-nums text-kv-white">
                      {formatPrice(totals.total)}
                    </dd>
                  </div>
                </dl>

                <Button
                  block
                  size="lg"
                  variant="whatsapp"
                  onClick={() => requireCustomer(openCheckout)}
                  disabled={!business?.whatsapp_number}
                >
                  <MessageCircle className="h-4 w-4" />
                  {business?.whatsapp_number ? 'Order on WhatsApp' : 'WhatsApp unavailable'}
                </Button>

                <p className="text-center text-2xs leading-relaxed text-kv-dim">
                  No online payment. You confirm the order, delivery and payment on WhatsApp.
                </p>
              </SheetFooter>
            </>
          )}
        </SheetContent>
      </Sheet>

      <WhatsAppCheckoutDialog
        open={isCheckoutOpen}
        onOpenChange={(next) => (next ? openCheckout() : closeCheckout())}
        onClearCart={clearCart}
      />
    </>
  );
}
