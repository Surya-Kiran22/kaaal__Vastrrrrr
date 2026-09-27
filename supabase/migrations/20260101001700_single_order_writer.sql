-- ===========================================================================
-- Kaal Vastr — 017 one writer for orders
--
-- 016 built `place_order` so that prices are read from the catalogue instead of
-- being taken from the request, and made the order and its lines one
-- transaction. It deliberately left the function SECURITY INVOKER, on the
-- reasoning that the RLS insert policies were what authorised the write.
--
-- That reasoning holds the function to a standard the rest of the schema did
-- not meet: `authenticated` still held a blanket INSERT grant on `orders` and
-- `order_items` (015 kept it so the pre-016 two-call checkout could still
-- finish). With those grants in place the policies authorise far more than the
-- function does, and everything 016 was built to guarantee became advisory.
--
-- A signed-in customer holding nothing but the public anon key could post
-- straight to /rest/v1/orders and /rest/v1/order_items, skipping the function
-- entirely. Because `order_items_recalc_order` sums `order_items.unit_price`,
-- and that column is client-supplied on insert, the trigger faithfully totalled
-- whatever the caller asked for. Reproduced on a clean database:
--
--     insert into orders    (reference, item_count, subtotal, total, ...)  -- declared
--     insert into order_items (unit_price, quantity, ...)                 -- priced
--
--     reference    | status | item_count | subtotal | savings  | total
--     --------------+--------+------------+----------+----------+-------
--     KV-ATTACK-0001| placed |         40 |     0.00 | 399960.00 | 0.00
--
-- Forty hoodies at a real Rs 4,499, totalling zero, sitting in the staff
-- dispatch log to be confirmed over WhatsApp. The same grants were also why
-- the fallback checkout path existed in the client at all.
--
-- The fix is to stop having two writers:
--
--   1. `place_order` becomes SECURITY DEFINER. It already re-checks the
--      caller's role, active/verified status, address ownership, product
--      visibility and per-variant stock by hand, and it never accepts
--      `user_id`, `reference`, `unit_price` or any total as input, so it does
--      not depend on the caller's grants or on RLS to be correct.
--   2. Nobody holds INSERT on `orders` or `order_items` any more, and the two
--      insert policies that existed only to serve the two-call path are
--      dropped so a future blanket re-grant cannot silently reopen this.
--
-- SELECT is untouched, so every read path and every policy below is unchanged.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- The function becomes the only writer. `set search_path = public` is already
-- declared on it, which is what keeps a definer function from being hijacked
-- through a temporary schema earlier in the path.
--
-- auth.uid() reads a session GUC, not a privilege, so it still resolves to the
-- customer rather than to this function's owner.
-- ---------------------------------------------------------------------------
create or replace function public.place_order(
  p_items          jsonb,
  p_delivery       jsonb  default null,
  p_notes          text   default null,
  p_address_id     uuid   default null,
  p_customer_name  text   default null,
  p_customer_phone text   default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  new_order_id    uuid;
  new_reference   text;
  item            jsonb;
  product_row     record;
  item_product_id uuid;
  item_color      text;
  item_size       text;
  item_qty        integer;
  line_count      integer := 0;
  available_units integer;
  stored_items    jsonb := '[]'::jsonb;
begin
  -- ---------------------------------------------------------------- session
  if auth.uid() is null then
    raise exception 'you must be signed in to place an order'
      using errcode = '28000';
  end if;

  -- Runs as the owner now, so this is the only thing standing between an
  -- authenticated session and the orders table. It must not be loosened.
  if not exists (
    select 1 from public.profiles p
     where p.id = auth.uid()
       and p.role = 'customer'
       and p.status = 'active'
       and p.is_active
       and p.email_verified_at is not null
  ) then
    raise exception 'only a verified, active customer can place an order'
      using errcode = '42501';
  end if;

  -- ---------------------------------------------------------------- payload
  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'items must be a JSON array' using errcode = '22023';
  end if;

  if jsonb_array_length(p_items) = 0 then
    raise exception 'an order needs at least one item' using errcode = '22023';
  end if;

  -- A guard rather than a business rule: this is a clothing store, not a
  -- wholesaler, and an unbounded array is only ever an attack.
  if jsonb_array_length(p_items) > 50 then
    raise exception 'an order cannot contain more than 50 lines' using errcode = '22023';
  end if;

  -- A delivery address is optional, because the storefront lets a customer
  -- check out with nothing saved -- the staff console labels that case
  -- "Pickup at store". When one *is* supplied it has to be complete, so a
  -- half-filled snapshot can never reach the dispatch log.
  if p_delivery is not null and jsonb_typeof(p_delivery) <> 'object' then
    raise exception 'the delivery address is malformed' using errcode = '22023';
  end if;

  if p_delivery is not null and (
       coalesce(btrim(p_delivery ->> 'full_name'), '') = ''
    or coalesce(btrim(p_delivery ->> 'phone'), '') = ''
    or coalesce(btrim(p_delivery ->> 'line1'), '') = ''
    or coalesce(btrim(p_delivery ->> 'city'), '') = ''
    or coalesce(btrim(p_delivery ->> 'pincode'), '') = ''
  ) then
    raise exception 'the delivery address is incomplete'
      using errcode = '22023';
  end if;

  -- Checked before the header is written. A foreign key alone would happily
  -- point at somebody else's saved address, which staff would then see.
  if p_address_id is not null and not exists (
    select 1 from public.addresses a where a.id = p_address_id and a.user_id = auth.uid()
  ) then
    raise exception 'that address does not belong to you' using errcode = '42501';
  end if;

  -- ------------------------------------------------------------ order header
  -- `reference` and `user_id` are filled by their own before-insert trigger,
  -- so the request never supplies either. With RLS bypassed under this
  -- function, that trigger is the only thing setting the owner.
  insert into public.orders (
    customer_name,
    customer_phone,
    notes,
    address_id,
    delivery
  )
  values (
    coalesce(
      nullif(btrim(coalesce(p_delivery ->> 'full_name', '')), ''),
      nullif(btrim(coalesce(p_customer_name, '')), ''),
      'Customer'
    ),
    coalesce(
      nullif(btrim(coalesce(p_delivery ->> 'phone', '')), ''),
      nullif(btrim(coalesce(p_customer_phone, '')), ''),
      ''
    ),
    nullif(btrim(coalesce(p_notes, '')), ''),
    p_address_id,
    p_delivery
  )
  returning id, reference into new_order_id, new_reference;

  -- ------------------------------------------------------------------- lines
  for item in select value from jsonb_array_elements(p_items)
  loop
    -- Validated by pattern before casting. Without the guard a malformed id
    -- raises 22P02 invalid_text_representation, which tells a caller nothing
    -- about what it should send instead.
    if coalesce(item ->> 'product_id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      raise exception 'every line needs a valid product id' using errcode = '22023';
    end if;
    item_product_id := (item ->> 'product_id')::uuid;

    if coalesce(item ->> 'quantity', '') !~ '^[0-9]{1,3}$' then
      raise exception 'every line needs a whole-number quantity' using errcode = '22023';
    end if;
    item_qty := (item ->> 'quantity')::integer;

    if item_qty < 1 or item_qty > 50 then
      raise exception 'quantity must be between 1 and 50' using errcode = '22023';
    end if;

    item_color := nullif(btrim(item ->> 'color'), '');
    item_size  := nullif(btrim(item ->> 'size'), '');

    -- Price, name and availability are read, never accepted. This is what
    -- stops a tampered request naming a cheaper price, an archived product, or
    -- a size that is sold out. The product read also bypasses RLS now, so the
    -- archived/available filter here is the only visibility rule that applies.
    select p.id,
           p.name,
           p.slug,
           p.sku,
           coalesce(p.images[1], p.image_url) as lead_image,
           p.selling_price,
           p.compare_at_price,
           p.variant_stock
      into product_row
      from public.products p
     where p.id = item_product_id
       and p.is_archived = false
       and p.is_available = true;

    if not found then
      raise exception 'one of the items is no longer available'
        using errcode = '22023';
    end if;

    -- Per-variant stock where the product tracks it. A missing combination
    -- reads as zero, the same rule the storefront uses, so adding a size to a
    -- product does not invent inventory.
    if product_row.variant_stock is not null
       and product_row.variant_stock <> '{}'::jsonb then
      available_units := coalesce(
        (product_row.variant_stock ->> (coalesce(item_color, '') || '|' || coalesce(item_size, '')))::integer,
        0
      );

      if available_units < item_qty then
        raise exception '% (% / %) has only % left',
          product_row.name,
          coalesce(item_color, 'any colour'),
          coalesce(item_size, 'any size'),
          available_units
          using errcode = '22023';
      end if;
    end if;

    insert into public.order_items (
      order_id, product_id, name, slug, sku, image, color, size,
      unit_price, compare_at_price, quantity, line_total
    )
    values (
      new_order_id,
      item_product_id,
      product_row.name,
      product_row.slug,
      product_row.sku,
      product_row.lead_image,
      item_color,
      item_size,
      product_row.selling_price,
      product_row.compare_at_price,
      item_qty,
      round(product_row.selling_price * item_qty, 2)
    );

    line_count := line_count + 1;

    stored_items := stored_items || jsonb_build_object(
      'product_id', item_product_id,
      'name', product_row.name,
      'slug', product_row.slug,
      'sku', product_row.sku,
      'image', product_row.lead_image,
      'color', item_color,
      'size', item_size,
      'unit_price', product_row.selling_price,
      'compare_at_price', product_row.compare_at_price,
      'quantity', item_qty,
      'line_total', round(product_row.selling_price * item_qty, 2)
    );
  end loop;

  if line_count = 0 then
    raise exception 'an order needs at least one item' using errcode = '22023';
  end if;

  -- `order_items_recalc_order` is SECURITY DEFINER and has already rewritten
  -- the money columns. Read them back so the checkout screen shows the figures
  -- the database holds, not the ones the client believed it sent.
  --
  -- The lines come back too. The WhatsApp message is built from these rather
  -- than from the cart, so if a price changed while the customer was filling
  -- in the form, the message the store receives matches the order that was
  -- actually stored.
  return jsonb_build_object(
    'id', new_order_id,
    'reference', new_reference,
    'item_count', (select o.item_count from public.orders o where o.id = new_order_id),
    'subtotal', (select o.subtotal from public.orders o where o.id = new_order_id),
    'savings', (select o.savings from public.orders o where o.id = new_order_id),
    'total', (select o.total from public.orders o where o.id = new_order_id),
    'items', stored_items
  );
end;
$$;

comment on function public.place_order(jsonb, jsonb, text, uuid, text, text) is
  'The only writer of orders and order_items. SECURITY DEFINER: it re-checks '
  'the caller''s role, active and verified status, address ownership, product '
  'visibility and per-variant stock itself, and takes no price, total, owner '
  'or reference from the request.';

-- Re-issued because CREATE OR REPLACE keeps the existing privileges, and the
-- function body is what now carries the authorisation.
revoke all on function public.place_order(jsonb, jsonb, text, uuid, text, text) from public, anon;
grant execute on function public.place_order(jsonb, jsonb, text, uuid, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Close the raw path. Before 017 both tables carried a blanket INSERT for
-- `authenticated`, which is the grant that made the attack above possible.
--
-- UPDATE and DELETE stay revoked as 015 left them: order status has exactly one
-- writer, `set_order_status`, and nobody rewrites a price after the fact.
-- ---------------------------------------------------------------------------
revoke insert, update, delete on public.orders from anon, authenticated;
revoke insert, update, delete on public.order_items from anon, authenticated;

-- The insert policies existed for the two-call checkout. With no INSERT grant
-- behind them they are inert, and an inert policy is a footgun: re-granting
-- INSERT later would silently reopen the hole these were meant to close.
drop policy if exists "orders_owner_insert" on public.orders;
drop policy if exists "order_items_insert_via_order" on public.order_items;

-- `order_items_admin_mutate` is the same story. It was a correction path for
-- admin, but the admin UI only ever reads order lines, so it authorises
-- nothing that is used and would permit a privileged account to post an
-- arbitrary unit_price. The admin keeps full read access through
-- `order_items_read_via_order`, which already admits `is_admin()`.
drop policy if exists "order_items_admin_mutate" on public.order_items;

-- Addresses stay fully customer-owned: a customer must be able to add, correct
-- and delete their own saved address without a round trip through checkout.
grant select, insert, update, delete on public.addresses to authenticated;

notify pgrst, 'reload schema';
