import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useAuth } from './useAuth';
import { useLiveQuery } from './useRealtime';
import { supabase } from '@/lib/supabase';
import { computeMessageTotals, type MessageLine, type OrderTotals } from '@/lib/whatsapp';
import {
  callStaffManagement,
  StaffManagementError,
  type StaffAction,
} from '@/lib/staff-management';
import type {
  Address,
  AddressDraft,
  Order,
  OrderItem,
  OrderStatus,
  ProfileRole,
  StaffAccount,
  StaffAccountEvent,
} from '@/types';

export const addressKeys = {
  all: ['addresses'] as const,
};

export const orderKeys = {
  all: ['orders'] as const,
  mine: ['orders', 'mine'] as const,
  staff: ['orders', 'staff'] as const,
};

export const staffKeys = {
  all: ['staff-accounts'] as const,
  events: ['staff-accounts', 'events'] as const,
};

const ORDER_ITEM_COLUMNS =
  'id, order_id, product_id, name, slug, sku, image, color, size, unit_price, compare_at_price, quantity, line_total';

const ORDER_COLUMNS =
  'id, reference, user_id, status, item_count, subtotal, savings, total, customer_name, customer_phone, notes, address_id, delivery, cancel_requested, status_note, status_updated_at, status_updated_by, contacted_at, dispatched_at, delivered_at, created_at, updated_at';

/* -------------------------------------------------------------------------- *
 * Addresses
 * -------------------------------------------------------------------------- */

export function useAddresses() {
  const { profile } = useAuth();
  const userId = profile?.id;

  return useLiveQuery<Address[]>(
    {
      queryKey: [...addressKeys.all, userId ?? 'anonymous'],
      enabled: Boolean(userId),
      queryFn: async () => {
        const { data, error } = await supabase
          .from('addresses')
          .select('*')
          .eq('user_id', userId as string)
          .order('is_default', { ascending: false })
          .order('created_at', { ascending: false });
        if (error) throw new Error(error.message);
        return (data ?? []) as Address[];
      },
    },
    { tables: ['addresses'] },
  );
}

function useAddressMutation<TInput>(mutationFn: (input: TInput) => Promise<void>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: addressKeys.all });
    },
  });
}

export function useSaveAddress() {
  return useAddressMutation<{ id?: string; draft: AddressDraft }>(async ({ id, draft }) => {
    const payload = {
      label: draft.label,
      full_name: draft.full_name,
      phone: draft.phone,
      line1: draft.line1,
      line2: draft.line2 || null,
      landmark: draft.landmark || null,
      city: draft.city,
      state: draft.state,
      pincode: draft.pincode,
      is_default: draft.is_default,
    };
    const query = id
      ? supabase.from('addresses').update(payload).eq('id', id)
      : supabase.from('addresses').insert(payload);
    const { error } = await query;
    if (error) throw new Error(error.message);
    toast.success(id ? 'Address updated' : 'Address saved');
  });
}

export function useDeleteAddress() {
  return useAddressMutation<string>(async (id) => {
    const { error } = await supabase.from('addresses').delete().eq('id', id);
    if (error) throw new Error(error.message);
    toast.success('Address removed');
  });
}

export function useSetDefaultAddress() {
  return useAddressMutation<string>(async (id) => {
    // A trigger demotes the previous default, so this is a single-column write.
    const { error } = await supabase.from('addresses').update({ is_default: true }).eq('id', id);
    if (error) throw new Error(error.message);
    toast.success('Default delivery address updated');
  });
}

/* -------------------------------------------------------------------------- *
 * Orders
 * -------------------------------------------------------------------------- */

export interface PlaceOrderInput {
  customerName: string;
  customerPhone: string;
  notes: string;
  address: Address | null;
  lines: {
    productId: string;
    name: string;
    slug: string;
    sku: string;
    image: string | null;
    color: string | null;
    size: string | null;
    unitPrice: number;
    compareAt: number | null;
    quantity: number;
  }[];
}

/**
 * The database is behind migration 016, so `place_order` does not exist.
 *
 * A distinct type rather than a plain string, because checkout treats this one
 * case differently: the order is not lost, it is handed to the store over
 * WhatsApp instead. Every other failure is a genuine error and must surface.
 */
export class PlaceOrderUnavailableError extends Error {
  constructor() {
    super('This shop cannot take orders online right now.');
    this.name = 'PlaceOrderUnavailableError';
  }
}

/**
 * Records the order and its lines in one call.
 *
 * `place_order` is the only writer of these two tables, so there is no client
 * path that could name its own price, owner or reference.
 *
 * Before the migration lands there is deliberately no two-call substitute. The
 * old path let the browser post `unit_price` and trusted
 * `order_items_recalc_order` to total it, which meant a customer could post
 * `unit_price: 1` and the trigger would believe them. A fallback that "works"
 * has to give that up, so the fallback is WhatsApp: nothing untrusted is written,
 * and the store receives the order on the channel it already uses. See
 * `loadAuthoritativeLines`.
 */
export function usePlaceOrder() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: PlaceOrderInput) => {
      const delivery = input.address
        ? {
            full_name: input.address.full_name,
            phone: input.address.phone,
            line1: input.address.line1,
            line2: input.address.line2,
            landmark: input.address.landmark,
            city: input.address.city,
            state: input.address.state,
            pincode: input.address.pincode,
          }
        : null;

      // Only identity and quantity travel. Prices are read from the catalogue
      // by `place_order`, so a tampered request cannot name its own total.
      const items = input.lines.map((line) => ({
        product_id: line.productId,
        color: line.color,
        size: line.size,
        quantity: line.quantity,
      }));

      const { data, error } = await supabase.rpc('place_order', {
        p_items: items,
        p_delivery: delivery,
        p_notes: input.notes || null,
        p_address_id: input.address?.id ?? null,
        // Sent separately because a pickup order carries no address, and the
        // dispatch log still needs a name and number to confirm against.
        p_customer_name: input.customerName || null,
        p_customer_phone: input.customerPhone || null,
      });

      if (error) {
        // Missing means the database is behind migration 016. It is not fatal
        // on its own: the caller falls back to WhatsApp rather than losing the
        // sale. See the note on usePlaceOrder.
        if (isMissingPlaceOrder(error)) {
          throw new PlaceOrderUnavailableError();
        }
        throw new Error(error.message);
      }

      const result = data as {
        id: string;
        reference: string;
        item_count: number;
        subtotal: number;
        savings: number;
        total: number;
        items?: StoredOrderLine[];
      };

      return {
        id: result.id,
        reference: result.reference,
        item_count: result.item_count,
        subtotal: Number(result.subtotal),
        savings: Number(result.savings),
        total: Number(result.total),
        items: (result.items ?? []).map((line) => ({
          productId: line.product_id,
          name: line.name,
          slug: line.slug,
          sku: line.sku,
          image: line.image,
          color: line.color,
          size: line.size,
          unitPrice: Number(line.unit_price),
          compareAt: line.compare_at_price === null ? null : Number(line.compare_at_price),
          quantity: Number(line.quantity),
        })),
      } satisfies PlaceOrderResult;
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: orderKeys.all }),
        queryClient.invalidateQueries({ queryKey: addressKeys.all }),
      ]);
    },
  });
}

export interface PlaceOrderResult {
  id: string;
  reference: string;
  item_count: number;
  subtotal: number;
  savings: number;
  total: number;
  /**
   * The lines as stored, not as the cart held them. The WhatsApp text is built
   * from these, so a price that moved while the customer was typing still
   * matches what the store is shown.
   */
  items?: {
    productId: string | null;
    name: string;
    slug: string | null;
    sku: string | null;
    image: string | null;
    color: string | null;
    size: string | null;
    unitPrice: number;
    compareAt: number | null;
    quantity: number;
  }[];
}

interface StoredOrderLine {
  product_id: string | null;
  name: string;
  slug: string | null;
  sku: string | null;
  image: string | null;
  color: string | null;
  size: string | null;
  unit_price: number | string;
  compare_at_price: number | string | null;
  quantity: number;
}

/**
 * True when the failure means "this function does not exist here", as opposed
 * to "this function rejected your input".
 *
 * Two codes, because the same missing function surfaces two ways: PostgREST
 * reports PGRST202 when the name is absent from its schema cache, and Postgres
 * reports 42883 when the cache was stale but the database also lacks it. A
 * permission problem (42501) is deliberately not included -- that is a real
 * fault and must not be silently downgraded to a WhatsApp hand-off.
 */
function isMissingPlaceOrder(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  if (error.code === 'PGRST202' || error.code === '42883') return true;
  return /could not find the function|schema cache|does not exist/i.test(error.message ?? '');
}

/** The minimum a line needs to be re-priced from the catalogue. */
export interface CartLineRequest {
  productId: string;
  color: string | null;
  size: string | null;
  quantity: number;
}

export interface AuthoritativeOrder {
  lines: MessageLine[];
  totals: OrderTotals;
}

const PRICE_COLUMNS =
  'id, name, slug, sku, image_url, images, selling_price, compare_at_price, is_archived, is_available, variant_stock';

interface PriceRow {
  id: string;
  name: string;
  slug: string | null;
  sku: string | null;
  image_url: string | null;
  images: string[] | null;
  selling_price: number | string;
  compare_at_price: number | string | null;
  is_archived: boolean;
  is_available: boolean;
  variant_stock: Record<string, number> | null;
}

/**
 * Re-reads prices from the catalogue for the WhatsApp fallback.
 *
 * This is the substitute for the money that `place_order` would have derived
 * server-side. `products` is readable by `anon` and `authenticated`, so these
 * numbers come from the same rows `place_order` would have read -- the browser
 * still never supplies them. Products that have since been archived, made
 * unavailable, or dropped the requested size are rejected here rather than
 * quoted, so the store is not handed an order it cannot fill.
 *
 * Writes nothing. That is the whole point: no partial order, no client-named
 * price, and nothing in `orders` for a customer to later find a gap in.
 */
export async function loadAuthoritativeLines(
  requested: CartLineRequest[],
): Promise<AuthoritativeOrder> {
  if (requested.length === 0) {
    throw new Error('Your cart is empty.');
  }

  const ids = Array.from(new Set(requested.map((line) => line.productId)));
  const { data, error } = await supabase
    .from('products')
    .select(PRICE_COLUMNS)
    .in('id', ids);

  if (error) {
    throw new Error(error.message);
  }

  const catalogue = new Map<string, PriceRow>();
  for (const row of (data ?? []) as unknown as PriceRow[]) {
    catalogue.set(row.id, row);
  }

  const lines: MessageLine[] = requested.map((wanted) => {
    const product = catalogue.get(wanted.productId);
    if (!product || product.is_archived || !product.is_available) {
      throw new Error('One of the items in your cart is no longer available.');
    }

    // Same per-variant rule as place_order: a missing combination reads as
    // zero, so adding a size to a product cannot invent inventory.
    const stock = product.variant_stock;
    if (stock && Object.keys(stock).length > 0) {
      const key = `${wanted.color ?? ''}|${wanted.size ?? ''}`;
      const available = stock[key] ?? 0;
      if (available < wanted.quantity) {
        throw new Error(`${product.name} only has ${available} left in that size.`);
      }
    }

    return {
      name: product.name,
      sku: product.sku,
      color: wanted.color,
      size: wanted.size,
      quantity: wanted.quantity,
      unitPrice: Number(product.selling_price),
      compareAt: product.compare_at_price === null ? null : Number(product.compare_at_price),
    };
  });

  return { lines, totals: computeMessageTotals(lines) };
}

export function useMyOrders() {
  const { profile } = useAuth();
  const userId = profile?.id;

  return useLiveQuery<Order[]>(
    {
      queryKey: [...orderKeys.mine, userId ?? 'anonymous'],
      enabled: Boolean(userId),
      queryFn: async () => {
        const { data, error } = await supabase
          .from('orders')
          .select(`${ORDER_COLUMNS}, order_items (${ORDER_ITEM_COLUMNS})`)
          .order('created_at', { ascending: false });
        if (error) throw new Error(error.message);
        return ((data ?? []) as unknown as Order[]).map(attachItems);
      },
    },
    { tables: ['orders', 'order_items'] },
  );
}

/** Staff view of the whole dispatch log. The database scopes this by role. */
export function useStaffOrders() {
  return useLiveQuery<Order[]>(
    {
      queryKey: [...orderKeys.staff],
      queryFn: async () => {
        const { data, error } = await supabase
          .from('orders')
          .select(`${ORDER_COLUMNS}, order_items (${ORDER_ITEM_COLUMNS})`)
          .order('created_at', { ascending: false });
        if (error) throw new Error(error.message);
        return ((data ?? []) as unknown as Order[]).map(attachItems);
      },
    },
    { tables: ['orders', 'order_items'] },
  );
}

function attachItems(order: Order): Order {
  const raw = (order as unknown as { order_items?: OrderItem[] }).order_items ?? [];
  return { ...order, items: raw };
}

/** Customers may ask to cancel; staff decide. Never updates `status` directly. */
export function useRequestCancellation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (orderId: string) => {
      const { error } = await supabase.rpc('request_order_cancellation', {
        p_order_id: orderId,
      });
      if (error) throw new Error(error.message);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: orderKeys.all });
      toast.success('Cancellation requested. The store will confirm on WhatsApp.');
    },
    onError: (error: Error) => toast.error(error.message),
  });
}

/** Staff-only. Admins are rejected by the database, not by this component. */
export function useSetOrderStatus() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      orderId,
      status,
      note,
    }: {
      orderId: string;
      status: OrderStatus;
      note?: string;
    }) => {
      const { error } = await supabase.rpc('set_order_status', {
        p_order_id: orderId,
        p_status: status,
        p_note: note ?? null,
      });
      if (error) throw new Error(error.message);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: orderKeys.all });
      toast.success('Dispatch status updated');
    },
    onError: (error: Error) => toast.error(error.message),
  });
}

/* -------------------------------------------------------------------------- *
 * Staff & admin accounts
 * -------------------------------------------------------------------------- */

const STAFF_COLUMNS =
  'id, email, full_name, phone, role, status, is_active, email_verified_at, invited_at, activated_at, suspended_at, created_at, updated_at';

export function useStaffAccounts(includeCustomers: boolean) {
  return useLiveQuery<StaffAccount[]>(
    {
      queryKey: [...staffKeys.all, includeCustomers ? 'all' : 'staff-only'],
      queryFn: async () => {
        let query = supabase.from('profiles').select(STAFF_COLUMNS);
        if (!includeCustomers) query = query.in('role', ['staff', 'admin']);
        const { data, error } = await query.order('created_at', { ascending: false });
        if (error) throw new Error(error.message);
        return (data ?? []) as StaffAccount[];
      },
    },
    { tables: ['profiles'] },
  );
}

export function useStaffEvents(limit = 20) {
  return useLiveQuery<StaffAccountEvent[]>(
    {
      queryKey: [...staffKeys.events, limit],
      queryFn: async () => {
        const { data, error } = await supabase
          .from('staff_account_events')
          .select('id, profile_id, actor_id, kind, detail, created_at')
          .order('created_at', { ascending: false })
          .limit(limit);
        if (error) throw new Error(error.message);
        return (data ?? []) as StaffAccountEvent[];
      },
    },
    { tables: ['staff_account_events'] },
  );
}

/**
 * Admin-only role and suspension changes.
 *
 * `set_account_role` always applies a concrete role, so a suspension has to
 * re-supply the account's current role. Passing null fails the NOT NULL
 * constraint on `profiles.role` rather than suspending anyone.
 */
export function useSetAccountRole() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      email,
      role,
      suspend,
    }: {
      email: string;
      role: ProfileRole;
      suspend: boolean;
    }) => {
      const { error } = await supabase.rpc('set_account_role', {
        target_email: email,
        new_role: role,
        suspend,
      });
      if (error) throw new Error(error.message);
    },
    onSuccess: async (_data, variables) => {
      await queryClient.invalidateQueries({ queryKey: staffKeys.all });
      toast.success(variables.suspend ? 'Account suspended' : 'Account updated');
    },
    onError: (error: Error) => toast.error(error.message),
  });
}

/* Staff invites (privileged Edge Function)
 * -------------------------------------------------------------------------- */

/**
 * One mutation for every privileged staff action, because they all go through
 * the same function and all have the same two failure modes: the function is not
 * deployed, or the caller is not an active admin.
 */
export function useStaffAction() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      action,
      email,
      role,
    }: {
      action: StaffAction;
      email: string;
      role?: ProfileRole;
    }) => {
      try {
        return await callStaffManagement({ action, email, role });
      } catch (error) {
        if (error instanceof StaffManagementError) throw error;
        throw new Error(error instanceof Error ? error.message : 'The request failed.');
      }
    },
    onSuccess: async (result) => {
      // The profile row and the audit trail both change server-side.
      await queryClient.invalidateQueries({ queryKey: staffKeys.all });
      toast.success(result.message);
    },
    onError: (error: Error) => {
      // A not-deployed function is a setup problem, so keep the guidance on
      // screen rather than collapsing it into a generic failure toast.
      if (error instanceof StaffManagementError && error.notDeployed) {
        toast.error(error.message, { duration: 12_000 });
        return;
      }
      toast.error(error.message);
    },
  });
}
