import { zodResolver } from '@hookform/resolvers/zod';
import { Link } from '@tanstack/react-router';
import { motion } from 'framer-motion';
import { ArrowRight, CheckCircle2, Copy, MessageCircle, ShieldCheck } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';
import { useCart } from '@/features/cart/cart-context';
import { useAddresses, loadAuthoritativeLines, PlaceOrderUnavailableError, usePlaceOrder } from '@/hooks/useAccount';
import { useOrderGate } from '@/hooks/useOrderGate';
import { useBusinessSettings } from '@/hooks/useProducts';
import { formatPrice } from '@/lib/format';
import { cn } from '@/lib/utils';
import {
  buildOrderMessage,
  type BuildOrderMessageInput,
  type MessageLine,
  toMessageLines,
  buildWhatsappLink,
  copyToClipboard,
  formatDeliveryAddress,
} from '@/lib/whatsapp';

/** The four figures a message quotes, always from one source and never mixed. */
type OrderTotals = BuildOrderMessageInput['totals'];
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Field, Input, Textarea } from '@/components/ui/input';

const schema = z.object({
  name: z
    .string()
    .trim()
    .min(2, 'Please enter your full name.')
    .max(80, 'Name looks too long.'),
  phone: z
    .string()
    .trim()
    .min(10, 'Enter a 10-digit mobile number.')
    .max(15, 'Phone number looks too long.')
    .regex(/^[+]?[\d\s-]{10,15}$/, 'Use digits, spaces, + or - only.'),
  notes: z
    .string()
    .trim()
    .max(400, 'Please keep delivery notes under 400 characters.')
    .optional()
    .or(z.literal('')),
  addressId: z.string().optional().or(z.literal('')),
});

type FormValues = z.infer<typeof schema>;

interface WhatsAppCheckoutDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onClearCart: () => void;
}

interface Handoff {
  url: string | null;
  reference: string;
  message: string;
  /**
   * Set when the database could not record the order and the store is being
   * reached over WhatsApp instead. There is no reference and nothing in My
   * Orders, so the confirmation copy has to stop claiming otherwise.
   */
  deferred: boolean;
}

export function WhatsAppCheckoutDialog({ open, onOpenChange, onClearCart }: WhatsAppCheckoutDialogProps) {
  const { lines, totals } = useCart();
  const { data: business } = useBusinessSettings();
  const { data: addresses, isError: addressesFailed, refetch: refetchAddresses } = useAddresses();
  const placeOrder = usePlaceOrder();
  const { requireCustomer } = useOrderGate();
  const [handoff, setHandoff] = useState<Handoff | null>(null);

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    mode: 'onTouched',
    defaultValues: { name: '', phone: '', notes: '', addressId: '' },
  });

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = form;

  const watched = useWatch({ control: form.control });

  const selectedAddress = useMemo(
    () => addresses?.find((address) => address.id === watched.addressId) ?? null,
    [addresses, watched.addressId],
  );

  const defaultAddress = useMemo(
    () => addresses?.find((address) => address.is_default) ?? addresses?.[0] ?? null,
    [addresses],
  );

  // A fresh checkout starts blank, and a saved address is offered as the
  // default so returning customers do not retype it every time.
  useEffect(() => {
    if (!open) return;
    setHandoff(null);
    reset({
      name: '',
      phone: '',
      notes: '',
      addressId: defaultAddress?.id ?? '',
    });
  }, [open, reset, defaultAddress?.id]);

  const customer = useMemo(
    () => ({
      name: watched.name?.trim() || 'Your name',
      phone: watched.phone?.trim() || 'Your number',
      notes: watched.notes?.trim() ?? '',
    }),
    [watched.name, watched.phone, watched.notes],
  );

  // Shown before the order exists, so the reference is not yet known.
  const preview = useMemo(
    () =>
      buildOrderMessage({
        business: business ?? null,
        lines,
        totals,
        customer,
        reference: null,
        delivery: selectedAddress,
      }),
    [business, lines, totals, customer, selectedAddress],
  );

  const handleCopy = useCallback(async () => {
    if (!handoff) return;
    const result = await copyToClipboard(handoff.message);
    if (result.ok) {
      toast.success('Order copied. Paste it into WhatsApp.');
    } else {
      toast.error('Could not copy automatically. Select the text above to copy it.');
    }
  }, [handoff]);

  const onSubmit = handleSubmit(async (values) => {
    // A failed address query leaves `addresses` undefined, which looks exactly
    // like "this customer has no saved addresses" and would quietly turn a
    // delivery order into a pickup one. Refuse instead, because getting the
    // destination wrong is worse than asking the customer to try again.
    if (addressesFailed) {
      form.setError('root', {
        message:
          'We could not load your saved addresses, so the delivery destination is unknown. Please retry, or place the order over WhatsApp.',
      });
      return;
    }

    // Belt and braces: the cart is already customer-only, but this is the
    // button that actually creates the order, so it re-checks first.
    requireCustomer(async () => {
      const deliveryAddress = addresses?.find((address) => address.id === values.addressId) ?? null;

      let reference = '';
      let savedLines: MessageLine[] = toMessageLines(lines);
      let savedTotals: OrderTotals = {
        itemCount: totals.itemCount,
        subtotal: totals.subtotal,
        savings: totals.savings,
        total: totals.total,
      };
      let deferred = false;
      try {
        // The order is recorded first so the customer gets a real reference and
        // the dispatch console has a row to work from.
        const order = await placeOrder.mutateAsync({
          customerName: values.name,
          customerPhone: values.phone,
          notes: values.notes ?? '',
          address: deliveryAddress,
          lines: lines.map((line) => ({
            productId: line.productId,
            name: line.name,
            slug: line.slug,
            sku: line.sku,
            image: line.image,
            color: line.color,
            size: line.size,
            unitPrice: line.unitPrice,
            compareAt: line.compareAt,
            quantity: line.quantity,
          })),
        });
        reference = order.reference;

        // Everything quoted from here on comes from the row the database just
        // wrote, never from the cart. `place_order` re-reads prices from the
        // catalogue, so the browser's copy can disagree with the saved order, and
        // a message that mixed stored lines with cart totals would show a total
        // that does not add up to the lines above it. The same has to be true of
        // the WhatsApp link, or the shop receives a different order from the one
        // the customer was shown.
        savedLines = order.items.length > 0 ? order.items : toMessageLines(lines);
        savedTotals = {
          itemCount: order.item_count,
          subtotal: order.subtotal,
          savings: order.savings,
          total: order.total,
        };
      } catch (error) {
        // Migration 016 has not reached this database yet. The sale is not lost:
        // re-price the cart from the catalogue and hand it to the store over
        // WhatsApp. Nothing is written, so there is no partial order and no
        // price the browser chose. Any other failure is a real fault.
        if (error instanceof PlaceOrderUnavailableError) {
          try {
            const authoritative = await loadAuthoritativeLines(
              lines.map((line) => ({
                productId: line.productId,
                color: line.color,
                size: line.size,
                quantity: line.quantity,
              })),
            );
            savedLines = authoritative.lines;
            savedTotals = authoritative.totals;
            deferred = true;
          } catch (priceError) {
            form.setError('root', {
              message:
                priceError instanceof Error
                  ? `We could not prepare your order: ${priceError.message}`
                  : 'We could not prepare your order. Please try again.',
            });
            return;
          }
        } else {
          form.setError('root', {
            message:
              error instanceof Error
                ? `We could not save your order: ${error.message}`
                : 'We could not save your order. Please try again.',
          });
          return;
        }
      }

      const message = buildOrderMessage({
        business: business ?? null,
        lines: savedLines,
        totals: savedTotals,
        customer: { name: values.name, phone: values.phone, notes: values.notes ?? '' },
        reference,
        delivery: deliveryAddress,
      });

      const result = buildWhatsappLink({
        business: business ?? null,
        lines: savedLines,
        totals: savedTotals,
        customer: { name: values.name, phone: values.phone, notes: values.notes ?? '' },
        reference,
        delivery: deliveryAddress,
      });

      if (!result.ok || !result.url) {
        // No WhatsApp number configured, or the number is malformed. When the
        // order was recorded the copy button is the only way forward. When it
        // was not, nothing is stored anywhere, so say so rather than implying
        // the store already has it.
        setHandoff({ url: null, reference, message, deferred });
        toast.error(
          deferred
            ? 'WhatsApp is unavailable and your order was not saved, so please contact the store directly.'
            : 'WhatsApp is unavailable, so please copy your order instead.',
        );
        return;
      }

      setHandoff({ url: result.url, reference, message, deferred });
      window.open(result.url, '_blank', 'noopener,noreferrer');
    });
  });

  const whatsappMissing = !business?.whatsapp_number;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        {handoff ? (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2.5">
                <CheckCircle2
                  className={handoff.deferred ? 'h-5 w-5 text-kv-warning' : 'h-5 w-5 text-kv-success'}
                  aria-hidden
                />
                {handoff.deferred ? 'Order ready to send' : 'Order saved'}
              </DialogTitle>
              <DialogDescription>
                {handoff.deferred
                  ? 'Online ordering is being upgraded, so this order has not been saved to your account. WhatsApp should have opened with your order ready to send -- press send there and the store will confirm.'
                  : handoff.url
                    ? 'WhatsApp should have opened in a new tab with your order ready to send. Press send there to confirm with the store.'
                    : 'WhatsApp could not be opened automatically. Copy your order below and send it to the store.'}
              </DialogDescription>
            </DialogHeader>
            <DialogBody className="space-y-5">
              {handoff.deferred ? (
                <div role="status" className="rounded-xl border border-kv-warning/30 bg-kv-warning/[0.07] p-4 text-sm text-kv-warning">
                  Nothing has been charged and no order has been recorded on the site. Sending the WhatsApp message
                  is what places it with the store, and they will reply with a reference and delivery details.
                </div>
              ) : null}
              <div className="rounded-xl border border-kv-line bg-kv-bg p-4">
                <p className="eyebrow">Order reference</p>
                <p className="mt-1 font-mono text-sm text-kv-white">
                  {handoff.deferred ? 'Issued by the store' : handoff.reference}
                </p>
                <p className="mt-2 text-2xs leading-relaxed text-kv-dim">
                  {handoff.deferred
                    ? 'Quote any reference the store gives you in WhatsApp so they can find this order.'
                    : 'Quote this on WhatsApp and the store can find your order straight away. You can also track it under My Orders.'}
                </p>
              </div>
              <div>
                <p className="eyebrow mb-2">Your order</p>
                <pre className="max-h-56 overflow-auto whitespace-pre-wrap rounded-xl border border-kv-line bg-kv-bg p-4 font-sans text-xs leading-relaxed text-kv-silver">
                  {handoff.message}
                </pre>
              </div>
            </DialogBody>
            <DialogFooter>
              {handoff.url ? (
                <Button asChild variant="whatsapp" onClick={() => window.open(handoff.url!, '_blank', 'noopener,noreferrer')}>
                  <a href={handoff.url} target="_blank" rel="noopener noreferrer">
                    <MessageCircle className="h-4 w-4" />
                    Reopen WhatsApp
                  </a>
                </Button>
              ) : null}
              <Button variant="secondary" onClick={handleCopy}>
                <Copy className="h-4 w-4" />
                Copy order
              </Button>
              <Button
                variant="ghost"
                onClick={() => {
                  onClearCart();
                  reset();
                  onOpenChange(false);
                }}
              >
                Start a new cart
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Confirm your order</DialogTitle>
              <DialogDescription>
                We do not take payments on this website. Add your details and we will open WhatsApp so you can
                confirm delivery and payment directly with {business?.business_name ?? 'the store'}.
              </DialogDescription>
            </DialogHeader>

            <form onSubmit={onSubmit} noValidate>
              <DialogBody className="space-y-5">
                {whatsappMissing ? (
                  <div className="rounded-xl border border-kv-warning/30 bg-kv-warning/[0.07] p-4 text-sm text-kv-warning">
                    The store WhatsApp number has not been configured yet. Please contact the store by phone
                    instead.
                  </div>
                ) : null}

                {form.formState.errors.root?.message ? (
                  <p role="alert" className="rounded-lg border border-kv-danger/30 bg-kv-danger/10 px-4 py-3 text-sm text-kv-danger">
                    {form.formState.errors.root.message}
                  </p>
                ) : null}

                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Full name" htmlFor="checkout-name" required error={errors.name?.message}>
                    <Input
                      id="checkout-name"
                      autoComplete="name"
                      placeholder="Aarav Sharma"
                      aria-invalid={Boolean(errors.name)}
                      {...register('name')}
                    />
                  </Field>
                  <Field
                    label="Mobile number"
                    htmlFor="checkout-phone"
                    required
                    hint="For order updates"
                    error={errors.phone?.message}
                  >
                    <Input
                      id="checkout-phone"
                      type="tel"
                      inputMode="tel"
                      autoComplete="tel"
                      placeholder="98765 43210"
                      aria-invalid={Boolean(errors.phone)}
                      {...register('phone')}
                    />
                  </Field>
                </div>

                {addressesFailed ? (
                  <Field label="Deliver to" htmlFor="checkout-address-error">
                    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-kv-lineStrong bg-kv-surface px-4 py-3">
                      <p className="text-2xs leading-relaxed text-kv-muted">
                        We could not load your saved addresses, so we cannot show where this order would go.
                        Please retry rather than risk choosing the wrong one.
                      </p>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => void refetchAddresses()}
                      >
                        Retry
                      </Button>
                    </div>
                  </Field>
                ) : addresses && addresses.length > 0 ? (
                  <Field
                    label="Deliver to"
                    htmlFor="checkout-address"
                    hint={
                      <Link
                        to="/account/addresses"
                        className="text-kv-dim underline-offset-2 hover:text-kv-silver hover:underline"
                      >
                        Manage addresses
                      </Link>
                    }
                  >
                    <div className="space-y-2">
                      {addresses.map((address) => {
                        const active = address.id === watched.addressId;
                        const lines = formatDeliveryAddress(address);
                        return (
                          <label
                            key={address.id}
                            className={cn(
                              'flex cursor-pointer items-start gap-3 rounded-xl border px-4 py-3 transition-colors',
                              active
                                ? 'border-kv-white/30 bg-kv-surface'
                                : 'border-kv-line hover:border-kv-lineStrong',
                            )}
                          >
                            <input
                              type="radio"
                              value={address.id}
                              className="mt-1 accent-kv-white"
                              {...register('addressId')}
                            />
                            <span className="min-w-0 flex-1">
                              <span className="flex items-center gap-2 text-xs text-kv-white">
                                {address.label}
                                {address.is_default ? (
                                  <span className="text-2xs uppercase tracking-widest text-kv-dim">
                                    Default
                                  </span>
                                ) : null}
                              </span>
                              <span className="mt-1 block text-2xs leading-relaxed text-kv-muted">
                                {address.full_name} · {address.phone}
                                <br />
                                {lines.join(', ')}
                              </span>
                            </span>
                          </label>
                        );
                      })}
                    </div>
                  </Field>
                ) : null}

                <Field
                  label={selectedAddress ? 'Anything to add?' : 'Delivery address or notes'}
                  htmlFor="checkout-notes"
                  hint={selectedAddress ? 'Optional' : 'Required if you have no saved address'}
                  error={errors.notes?.message}
                >
                  <Textarea
                    id="checkout-notes"
                    rows={3}
                    placeholder="Flat 402, Silver Residency, Bandra West, Mumbai 400050"
                    aria-invalid={Boolean(errors.notes)}
                    {...register('notes')}
                  />
                </Field>

                <div className="rounded-xl border border-kv-line bg-kv-bg">
                  <div className="flex items-center justify-between border-b border-kv-line px-4 py-3 text-2xs uppercase tracking-widest text-kv-dim">
                    <span>
                      {totals.itemCount} item{totals.itemCount === 1 ? '' : 's'} · {totals.lineCount} line
                      {totals.lineCount === 1 ? '' : 's'}
                    </span>
                    <span>Total</span>
                  </div>
                  <ul className="max-h-44 divide-y divide-kv-line overflow-y-auto px-4">
                    {lines.map((line) => (
                      <li key={line.id} className="flex justify-between gap-3 py-2.5 text-xs">
                        <span className="min-w-0 text-kv-silver">
                          <span className="text-kv-white">{line.quantity}×</span> {line.name}
                          <span className="text-kv-dim">
                            {' '}
                            {[line.color, line.size].filter(Boolean).join(' / ')}
                          </span>
                        </span>
                        <span className="shrink-0 tabular-nums text-kv-white">
                          {formatPrice(line.unitPrice * line.quantity)}
                        </span>
                      </li>
                    ))}
                  </ul>
                  <div className="flex items-center justify-between border-t border-kv-line px-4 py-3">
                    <span className="text-xs uppercase tracking-widest text-kv-muted">Amount to pay</span>
                    <span className="font-display text-lg tabular-nums text-kv-white">
                      {formatPrice(totals.total)}
                    </span>
                  </div>
                </div>

                <details className="rounded-xl border border-kv-line bg-kv-bg">
                  <summary className="cursor-pointer px-4 py-3 text-2xs uppercase tracking-widest text-kv-dim transition-colors hover:text-kv-silver">
                    Preview the WhatsApp message
                  </summary>
                  <pre className="max-h-48 overflow-auto whitespace-pre-wrap border-t border-kv-line px-4 py-3 font-sans text-xs leading-relaxed text-kv-silver">
                    {preview}
                  </pre>
                </details>

                <p className="flex items-start gap-2 text-2xs leading-relaxed text-kv-dim">
                  <ShieldCheck className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden />
                  We save this order to your account so you can track it and so our team can dispatch it. No
                  payment is taken on this website.
                </p>
              </DialogBody>

              <DialogFooter>
                <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
                  Keep shopping
                </Button>
                <Button
                  type="submit"
                  variant="whatsapp"
                  loading={isSubmitting || placeOrder.isPending}
                  loadingText="Saving your order…"
                  disabled={lines.length === 0}
                >
                  <MessageCircle className="h-4 w-4" />
                  Send order on WhatsApp
                  <ArrowRight className="h-4 w-4" />
                </Button>
              </DialogFooter>
            </form>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** Compact animated total used in the drawer footer. */
export function CartTotalPulse({ value }: { value: string }) {
  return (
    <motion.span
      key={value}
      initial={{ opacity: 0.4, y: -2 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
      className="tabular-nums"
    >
      {value}
    </motion.span>
  );
}
