-- 20260101002200_shareable_invoices.sql
--
-- Shareable invoice links.
--
-- A console operator can mint a long random token against a single order and
-- hand the customer a /invoice/<token> URL. The page is public, so the lookup
-- goes through a SECURITY DEFINER function that returns exactly one order -
-- the table itself stays behind RLS (the `orders_read` policy only admits the
-- owner or staff, so an anonymous direct select already returns nothing).
--
-- Deliberately NOT dependent on `public.is_staff_or_admin()` / `is_admin()`:
-- migration 021 moves those helpers into the `private` schema and drops the
-- public wrappers, so referencing them here would make this file fail purely
-- because of the order in which migrations were applied. The role check below
-- is self-contained and reads public.profiles directly.
--
-- Deliberately mints tokens on demand instead of backfilling every order:
-- a token existing is an explicit decision to share that order.

alter table public.orders
  add column if not exists public_token text;

comment on column public.orders.public_token is
  'Unguessable share token for the public invoice page. NULL until an operator '
  'deliberately issues one via public.issue_invoice_token().';

-- Partial unique index: many orders legitimately have no token, and Postgres
-- treats NULLs as distinct, so a plain unique index would also work - but the
-- partial form states the intent and keeps the index small.
create unique index if not exists orders_public_token_key
  on public.orders (public_token)
  where public_token is not null;

-- -----------------------------------------------------------------------
-- Console-side token lifecycle
-- -----------------------------------------------------------------------

-- Issues the token for an order, or returns the existing one. Idempotent so
-- the "Copy invoice link" button can be pressed repeatedly.
create or replace function public.issue_invoice_token(_order_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_token text;
begin
  if not exists (
    select 1
    from public.profiles
    where id = auth.uid()
      and role in ('admin', 'staff')
      and is_active
  ) then
    raise exception 'not permitted' using errcode = '42501';
  end if;

  if not exists (select 1 from public.orders where id = _order_id) then
    raise exception 'order not found' using errcode = 'P0002';
  end if;

  -- 128 bits of entropy from the built-in UUID generator. Deliberately avoids
  -- gen_random_bytes(), which would require the pgcrypto extension.
  update public.orders
     set public_token = coalesce(
           public_token,
           encode(gen_random_uuid()::bytea, 'hex')
         )
   where id = _order_id
  returning public_token into v_token;

  return v_token;
end;
$$;

comment on function public.issue_invoice_token(uuid) is
  'Returns (minting if needed) the share token for one order. Console roles only.';

-- Unsharing. The order itself is untouched; only the public link dies.
create or replace function public.revoke_invoice_token(_order_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1
    from public.profiles
    where id = auth.uid()
      and role in ('admin', 'staff')
      and is_active
  ) then
    raise exception 'not permitted' using errcode = '42501';
  end if;

  update public.orders
     set public_token = null
   where id = _order_id;
end;
$$;

comment on function public.revoke_invoice_token(uuid) is
  'Clears the share token for one order, unpublishing its invoice. Console roles only.';

-- -----------------------------------------------------------------------
-- Public lookup
-- -----------------------------------------------------------------------

-- Returns the single order matching the token, with its line items folded into
-- a jsonb array so the client needs one round trip. SECURITY DEFINER bypasses
-- RLS, which is the point: the token is the authorisation.
--
-- Business name / address are NOT returned here. business_settings already has
-- a public read policy, so the client fetches those separately and this
-- function stays narrow.
--
-- A blank token is coerced to NULL so it can never match an unset
-- public_token; the lookup is public, so do not rely on the index alone.
create or replace function public.get_invoice_by_token(_token text)
returns table (
  order_id   uuid,
  reference  text,
  status     text,
  placed_at  timestamptz,
  customer   text,
  phone      text,
  subtotal   numeric,
  savings    numeric,
  total      numeric,
  item_count integer,
  notes      text,
  items      jsonb
)
language sql
stable
security definer
set search_path = public
as $$
  select
    o.id,
    o.reference,
    o.status,
    o.created_at,
    o.customer_name,
    o.customer_phone,
    o.subtotal,
    o.savings,
    o.total,
    o.item_count,
    o.notes,
    coalesce(
      (
        select jsonb_agg(
                 jsonb_build_object(
                   'name',       oi.name,
                   'sku',        oi.sku,
                   'image',      oi.image,
                   'color',      oi.color,
                   'size',       oi.size,
                   'quantity',   oi.quantity,
                   'unit_price', oi.unit_price,
                   'line_total', oi.line_total
                 )
                 order by oi.name, oi.size
               )
        from public.order_items oi
        where oi.order_id = o.id
      ),
      '[]'::jsonb
    )
  from public.orders o
  where o.public_token is not null
    and o.public_token = nullif(btrim(_token), '')
  limit 1;
$$;

-- -----------------------------------------------------------------------
-- Privileges
-- -----------------------------------------------------------------------

-- `public` in Postgres means "every role", including anon. Revoke first, then
-- grant the minimum.
revoke all on function public.issue_invoice_token(uuid)  from public;
revoke all on function public.revoke_invoice_token(uuid)  from public;
revoke all on function public.get_invoice_by_token(text)  from public;

grant execute on function public.issue_invoice_token(uuid) to authenticated;
grant execute on function public.revoke_invoice_token(uuid) to authenticated;
grant execute on function public.get_invoice_by_token(text) to anon, authenticated;

-- The token column itself is readable by the order owner and staff through the
-- existing `orders_read` policy, which is intended: a customer can re-copy
-- their own link. It is NOT readable by anon, because the policy denies them.

notify pgrst, 'reload schema';
