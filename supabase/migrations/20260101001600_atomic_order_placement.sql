-- ===========================================================================
-- 016 atomic order placement
--
-- Checkout used to be two client round trips: insert `orders`, then insert
-- `order_items`. If the second failed the order still existed, with no lines
-- and a total of zero, and the customer had already been shown a reference as
-- if it were placed.
--
-- This replaces both with a single call. Two things get better at once:
--
--   1. Atomicity. Either the order and all of its lines exist, or nothing
--      does. A partial order is no longer representable.
--
--   2. Price integrity. Line prices are now read from `products` inside the
--      function, not taken from the request. Previously a modified client could
--      post `unit_price: 1` and the recalc trigger would faithfully total it.
--      The request now carries identity (product id, colour, size) and quantity
--      only â€” the money is derived.
--
-- SECURITY INVOKER, not DEFINER. That is the point: the function runs with the
-- caller's privileges, so `orders_owner_insert` and
-- `order_items_insert_via_order` are still what authorise the write, and
-- `auth.uid()` is still the customer. A DEFINER function would have to
-- re-implement both checks by hand, and any slip in that re-implementation
-- would be a privilege escalation.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- Validated before anything is written, so a bad payload fails with a readable
-- message instead of a constraint violation partway through.
--
-- Runs as the caller, so an anonymous request fails on the auth.uid() check
-- rather than on a privilege error.
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
security invoker
set search_path = public
as $$
declare
  new_order_id   uuid;
  new_reference  text;
  item           jsonb;
  product_row    record;
  item_product_id uuid;
  item_color     text;
  item_size      text;
  item_qty       integer;
  line_count     integer := 0;
  available_units integer;
  -- Accumulated in the loop, so the lines come back in the order the customer
  -- chose them. `order_items` has no sequence column and its ids are random
  -- uuids, so there is nothing to sort by afterwards.
  stored_items   jsonb := '[]'::jsonb;
begin
  -- ---------------------------------------------------------------- session
  if auth.uid() is null then
    raise exception 'you must be signed in to place an order'
      using errcode = '28000';
  end if;

  -- A staff member has no cart, and a suspended or unverified account has no
  -- business ordering.
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
  -- "Pickup at store". Rejecting it here would break a flow that already works
  -- on the two-call path and that the addresses table has no data for.
  --
  -- When an address *is* supplied it has to be complete, so a half-filled
  -- snapshot can never reach the dispatch log.
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

  -- ------------------------------------------------------------ order header
  -- `reference` and `user_id` are filled by their own before-insert trigger,
  -- so the request never supplies either.
  --
  -- `customer_name` / `customer_phone` come from the request rather than the
  -- address, because a pickup order has no address and the store still needs
  -- somebody to confirm with. The address snapshot wins when both are present.
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

  -- Checked after the insert so the failure is caught inside this transaction
  -- and the order disappears with it. A foreign key alone would happily point
  -- at somebody else's saved address, which staff would then see.
  if p_address_id is not null and not exists (
    select 1 from public.addresses a where a.id = p_address_id and a.user_id = auth.uid()
  ) then
    raise exception 'that address does not belong to you' using errcode = '42501';
  end if;

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
    -- a size that is sold out.
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
  'Places an order and all of its lines in one transaction. Prices are read '
  'from the catalogue, never taken from the request. Runs as the caller, so '
  'the existing RLS policies are what authorise the write.';

-- `authenticated` only. An anonymous caller must not reach the function at
-- all, even though the invoker body would reject it anyway.
revoke all on function public.place_order(jsonb, jsonb, text, uuid, text, text) from public, anon;
grant execute on function public.place_order(jsonb, jsonb, text, uuid, text, text) to authenticated;

notify pgrst, 'reload schema';
