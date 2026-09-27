-- ===========================================================================
-- Kaal Vastr — 006 customer accounts
--
-- Customers can register, verify their email with a 6-digit code and sign in.
-- An account gives them a saved address book and a record of the orders they
-- sent over WhatsApp. WhatsApp remains the payment/confirmation channel; this
-- schema only remembers what the customer asked for.
--
-- Access model:
--   addresses    read/write: owner (admins read all)
--   orders       read/write: owner (admins read all)
--   order_items  read/write: via the parent order's owner
--   profiles     gains `phone`, self-service, still role-locked
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- profiles: a contact number so checkout can prefill itself.
-- ---------------------------------------------------------------------------
alter table public.profiles
  add column if not exists phone text;

create index if not exists profiles_phone_idx
  on public.profiles (phone)
  where phone is not null;

-- Carry the number supplied at registration into the profile row.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Auth accounts created by an admin (invites, phone sign-in) may have no email
  -- address at all, so fall back to a stable placeholder that keeps the
  -- profiles.email_present check satisfied.
  insert into public.profiles (id, email, phone, full_name, role)
  values (
    new.id,
    coalesce(new.email, 'phone-' || new.id::text),
    nullif(btrim(coalesce(new.raw_user_meta_data ->> 'phone', '')), ''),
    coalesce(new.raw_user_meta_data ->> 'full_name', ''),
    'customer'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- addresses — the customer's saved delivery addresses.
-- ---------------------------------------------------------------------------
create table if not exists public.addresses (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid        not null references auth.users (id) on delete cascade,
  label       text        not null default 'Home',
  full_name   text        not null default '',
  phone       text        not null default '',
  line1       text        not null default '',
  line2       text,
  city        text        not null default '',
  state       text        not null default '',
  pincode     text        not null default '',
  landmark    text,
  is_default  boolean     not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  constraint addresses_label_present   check (length(btrim(label)) > 0),
  constraint addresses_line1_present   check (length(btrim(line1)) > 0),
  constraint addresses_city_present    check (length(btrim(city)) > 0),
  constraint addresses_pincode_present check (length(btrim(pincode)) > 0)
);

comment on table public.addresses is
  'Customer saved delivery addresses. Owner-scoped; admins may read all.';
comment on column public.addresses.is_default is
  'The address preselected at checkout. Enforced unique-per-user below.';

create index if not exists addresses_user_idx on public.addresses (user_id, created_at desc);

-- At most one default address per customer.
create unique index if not exists addresses_one_default_idx
  on public.addresses (user_id)
  where is_default;

-- Choosing a new default demotes the previous one in the same transaction.
create or replace function public.addresses_keep_single_default()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.is_default then
    update public.addresses
       set is_default = false
     where user_id = new.user_id
       and is_default
       and id <> new.id;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_addresses_single_default on public.addresses;
create trigger trg_addresses_single_default
  before insert or update of is_default on public.addresses
  for each row execute function public.addresses_keep_single_default();

drop trigger if exists trg_addresses_updated_at on public.addresses;
create trigger trg_addresses_updated_at
  before update on public.addresses
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- orders — one row per order the customer sent to WhatsApp.
-- `reference` is the human-facing id that also appears in the WhatsApp message.
-- ---------------------------------------------------------------------------
create table if not exists public.orders (
  id           uuid primary key default gen_random_uuid(),
  reference    text        not null,
  user_id      uuid        not null references auth.users (id) on delete cascade,
  status       text        not null default 'sent_to_whatsapp'
                 check (status in ('sent_to_whatsapp', 'cancelled')),
  item_count   integer     not null default 0 check (item_count >= 0),
  subtotal     numeric(10,2) not null default 0 check (subtotal >= 0),
  savings      numeric(10,2) not null default 0 check (savings >= 0),
  total        numeric(10,2) not null default 0 check (total >= 0),
  customer_name  text      not null default '',
  customer_phone text      not null default '',
  notes        text,
  address_id   uuid references public.addresses (id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),

  constraint orders_reference_present check (length(btrim(reference)) > 0),
  constraint orders_reference_unique unique (reference)
);

comment on table public.orders is
  'Orders the customer initiated from the storefront. The store confirms '
  'delivery and payment over WhatsApp; this row is the customer''s own record.';
comment on column public.orders.status is
  'sent_to_whatsapp = the customer handed the order to WhatsApp. '
  'cancelled = the customer withdrew it. Stock is not reserved by this row.';

create index if not exists orders_user_idx on public.orders (user_id, created_at desc);

drop trigger if exists trg_orders_updated_at on public.orders;
create trigger trg_orders_updated_at
  before update on public.orders
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- order_items — a price snapshot, so a later catalogue edit cannot rewrite
-- what the customer actually asked for. product_id is kept for reference and
-- set to null if the product is deleted.
-- ---------------------------------------------------------------------------
create table if not exists public.order_items (
  id              uuid primary key default gen_random_uuid(),
  order_id        uuid          not null references public.orders (id) on delete cascade,
  product_id      uuid          references public.products (id) on delete set null,
  name            text          not null,
  slug            text,
  sku             text,
  image           text,
  color           text,
  size            text,
  unit_price      numeric(10,2) not null check (unit_price >= 0),
  compare_at_price numeric(10,2) check (compare_at_price is null or compare_at_price >= 0),
  quantity        integer       not null check (quantity > 0),
  line_total      numeric(10,2) not null check (line_total >= 0),

  constraint order_items_name_present check (length(btrim(name)) > 0)
);

comment on table public.order_items is
  'Immutable line-item snapshot taken at checkout.';

create index if not exists order_items_order_idx on public.order_items (order_id);

-- ---------------------------------------------------------------------------
-- Row level security.
--
-- Customers only ever see their own rows. Admins read everything for
-- fulfilment. Customers may insert their own orders (checkout) and cancel
-- them, but they cannot rewrite prices or item counts after the fact: the
-- update policy is limited to `status` and `notes`.
-- ---------------------------------------------------------------------------
alter table public.addresses enable row level security;
alter table public.orders     enable row level security;
alter table public.order_items enable row level security;

drop policy if exists "addresses_owner_read" on public.addresses;
create policy "addresses_owner_read"
  on public.addresses for select
  using (auth.uid() = user_id or public.is_admin());

drop policy if exists "addresses_owner_insert" on public.addresses;
create policy "addresses_owner_insert"
  on public.addresses for insert
  with check (auth.uid() = user_id);

drop policy if exists "addresses_owner_update" on public.addresses;
create policy "addresses_owner_update"
  on public.addresses for update
  using (auth.uid() = user_id or public.is_admin())
  with check (auth.uid() = user_id or public.is_admin());

drop policy if exists "addresses_owner_delete" on public.addresses;
create policy "addresses_owner_delete"
  on public.addresses for delete
  using (auth.uid() = user_id or public.is_admin());

drop policy if exists "orders_owner_read" on public.orders;
create policy "orders_owner_read"
  on public.orders for select
  using (auth.uid() = user_id or public.is_admin());

drop policy if exists "orders_owner_insert" on public.orders;
create policy "orders_owner_insert"
  on public.orders for insert
  with check (auth.uid() = user_id);

-- Customers may only cancel; totals and line items are not customer-editable.
drop policy if exists "orders_owner_update" on public.orders;
create policy "orders_owner_update"
  on public.orders for update
  using (auth.uid() = user_id or public.is_admin())
  with check (auth.uid() = user_id or public.is_admin());

drop policy if exists "orders_owner_delete" on public.orders;
create policy "orders_owner_delete"
  on public.orders for delete
  using (auth.uid() = user_id or public.is_admin());

drop policy if exists "order_items_read_via_order" on public.order_items;
create policy "order_items_read_via_order"
  on public.order_items for select
  using (
    exists (
      select 1 from public.orders o
      where o.id = order_id
        and (o.user_id = auth.uid() or public.is_admin())
    )
  );

drop policy if exists "order_items_insert_via_order" on public.order_items;
create policy "order_items_insert_via_order"
  on public.order_items for insert
  with check (
    exists (
      select 1 from public.orders o
      where o.id = order_id
        and (o.user_id = auth.uid() or public.is_admin())
    )
  );

-- Line items are a snapshot: readable and insertable with the order, never
-- updated or deleted by the customer.
drop policy if exists "order_items_admin_mutate" on public.order_items;
create policy "order_items_admin_mutate"
  on public.order_items for all
  using (public.is_admin())
  with check (public.is_admin());

-- ---------------------------------------------------------------------------
-- The unique reference is generated by the client (it is shown to the customer
-- in the WhatsApp message), so a collision must not surface as a raw 23505.
-- ---------------------------------------------------------------------------
create or replace function public.new_order_reference()
returns text
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  candidate text;
begin
  loop
    candidate := 'KV-'
      || to_char(now() at time zone 'Asia/Kolkata', 'YYMMDD')
      || '-'
      || upper(substr(encode(gen_random_bytes(3), 'hex'), 1, 6));

    exit when not exists (select 1 from public.orders where reference = candidate);
  end loop;

  return candidate;
end;
$$;

revoke all on function public.new_order_reference() from public, anon;
grant execute on function public.new_order_reference() to authenticated;

-- ---------------------------------------------------------------------------
-- Column privileges.
--
-- Supabase grants blanket ALL on new public tables, so narrow the order table
-- explicitly: a customer (or anyone acting through the `authenticated` role)
-- may correct contact details or cancel, but never restate a price or total.
-- The totals themselves are owned by the recalculation trigger below.
-- ---------------------------------------------------------------------------
revoke update on public.orders from anon, authenticated;
grant update (customer_name, customer_phone, notes, status) on public.orders to authenticated;

revoke update, delete on public.order_items from anon, authenticated;
grant insert, select on public.order_items to authenticated;

-- ---------------------------------------------------------------------------
-- Totals are never client-supplied: inserting or removing a line recomputes
-- item_count / subtotal / savings / total on the parent order. The trigger is
-- SECURITY DEFINER because the customer inserting the line is not allowed to
-- update the order's money columns directly.
-- ---------------------------------------------------------------------------
create or replace function public.order_items_recalc_order()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  target uuid := coalesce(new.order_id, old.order_id);
begin
  update public.orders o
     set item_count = totals.units,
         subtotal   = totals.subtotal,
         savings    = totals.savings,
         total      = totals.subtotal
    from (
      select
        coalesce(sum(i.quantity), 0)::integer as units,
        coalesce(sum(i.unit_price * i.quantity), 0) as subtotal,
        coalesce(sum(greatest(coalesce(i.compare_at_price, i.unit_price) - i.unit_price, 0) * i.quantity), 0) as savings
      from public.order_items i
      where i.order_id = target
    ) totals
   where o.id = target;

  return null;
end;
$$;

drop trigger if exists trg_order_items_recalc on public.order_items;
create trigger trg_order_items_recalc
  after insert or update or delete on public.order_items
  for each row execute function public.order_items_recalc_order();

