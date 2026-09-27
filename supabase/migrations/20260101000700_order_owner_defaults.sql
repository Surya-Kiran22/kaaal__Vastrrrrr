-- ===========================================================================
-- Kaal Vastr — 007 owner columns are assigned by the database
--
-- 006 left `addresses.user_id` and `orders.user_id` to be supplied by the
-- client. That is both awkward and unsafe: the browser would have to echo back
-- a user id, and `with check (auth.uid() = user_id)` would reject every insert
-- that omitted it. RLS is the backstop, but the owner should not be client
-- input at all.
--
-- These BEFORE INSERT triggers stamp the owner from the verified JWT, and
-- generate the human-facing order reference server-side. Client-supplied
-- values are ignored whenever there is a session, so a crafted payload cannot
-- file an order or an address under somebody else's account. Service-role and
-- SQL-editor inserts (no JWT) may still set them explicitly.
-- ===========================================================================

create or replace function public.addresses_assign_owner()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is not null then
    new.user_id := auth.uid();
  elsif new.user_id is null then
    raise exception 'addresses.user_id is required when there is no authenticated session'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_addresses_assign_owner on public.addresses;
create trigger trg_addresses_assign_owner
  before insert on public.addresses
  for each row execute function public.addresses_assign_owner();


create or replace function public.orders_assign_owner()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is not null then
    new.user_id := auth.uid();

    -- The reference is shown to the customer in the WhatsApp message, so it is
    -- generated once, here, and the recorded order can never disagree with it.
    if new.reference is null or btrim(new.reference) = '' then
      new.reference := public.new_order_reference();
    end if;
  else
    if new.user_id is null then
      raise exception 'orders.user_id is required when there is no authenticated session'
        using errcode = '42501';
    end if;

    if new.reference is null or btrim(new.reference) = '' then
      new.reference := public.new_order_reference();
    end if;
  end if;

  -- The money columns are owned by the order_items recalculation trigger. Clear
  -- whatever the client claimed so a stored order can never disagree with its
  -- own line items.
  new.item_count := 0;
  new.subtotal   := 0;
  new.savings    := 0;
  new.total      := 0;

  return new;
end;
$$;

drop trigger if exists trg_orders_assign_owner on public.orders;
create trigger trg_orders_assign_owner
  before insert on public.orders
  for each row execute function public.orders_assign_owner();

-- A customer cancelling must not be able to flip the status to an unknown
-- value; the column check already constrains it, this just documents intent.
comment on column public.orders.reference is
  'Human-facing order id, generated server-side. Also included in the WhatsApp '
  'message so the customer and the store refer to the same order.';
comment on column public.orders.total is
  'Always derived from order_items by trg_order_items_recalc. Never client input.';
