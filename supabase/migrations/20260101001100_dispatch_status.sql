-- ===========================================================================
-- Kaal Vastr — 011 dispatch status and who may change it
--
-- Requirement: staff own the dispatch log; admins may read it but must not be
-- able to change it, enforced in the database and not just in the UI.
--
-- A plain RLS policy cannot express "staff may UPDATE, admin may SELECT" while
-- both roles share the same Postgres role (`authenticated`) and the same table
-- privileges. Column-level grants do not help either, because they are granted
-- per role rather than per user. So nobody gets direct UPDATE on orders at all;
-- status changes go through a SECURITY DEFINER function that checks the
-- caller's role in profiles and raises for anyone who is not staff. An admin
-- calling it is rejected by the database, not merely by a disabled button.
--
-- Customers keep read access to their own history, can flag a cancellation, and
-- can no longer write `status` themselves.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Snapshot the delivery address on the order.
--
-- The order referenced the customer's address by id, so deleting or editing an
-- address silently rewrote the delivery details of orders already placed. The
-- WhatsApp message and the dispatch log both need the address as it was when
-- the customer ordered, so store a copy.
-- ---------------------------------------------------------------------------
alter table public.orders
  add column if not exists delivery jsonb;

comment on column public.orders.delivery is
  'Snapshot of the chosen address taken at checkout. Kept so a later address '
  'edit or delete cannot rewrite the delivery details of a placed order.';

-- ---------------------------------------------------------------------------
-- 2. Replace the two-state status with the dispatch lifecycle.
-- ---------------------------------------------------------------------------
update public.orders set status = 'placed' where status = 'sent_to_whatsapp';

alter table public.orders drop constraint if exists orders_status_check;
alter table public.orders add constraint orders_status_check
  check (status in ('placed', 'contacted', 'dispatched', 'delivered', 'cancelled'));

alter table public.orders alter column status set default 'placed';

alter table public.orders
  add column if not exists cancel_requested boolean not null default false,
  add column if not exists status_note text,
  add column if not exists status_updated_at timestamptz,
  add column if not exists status_updated_by uuid references public.profiles (id) on delete set null,
  add column if not exists contacted_at timestamptz,
  add column if not exists dispatched_at timestamptz,
  add column if not exists delivered_at timestamptz;

comment on column public.orders.status is
  'Dispatch state. Only staff may change it, via set_order_status(). '
  'delivered and cancelled are terminal.';
comment on column public.orders.cancel_requested is
  'Set by the customer. Staff action the request with set_order_status().';

create index if not exists orders_status_created_idx on public.orders (status, created_at desc);
create index if not exists orders_cancel_requested_idx
  on public.orders (created_at desc)
  where cancel_requested;

-- ---------------------------------------------------------------------------
-- 3. Take direct UPDATE away from every client role.
-- ---------------------------------------------------------------------------
revoke update on public.orders from anon, authenticated;

-- The customer's old "cancel your own order" policy goes away entirely.
drop policy if exists "orders_owner_update" on public.orders;

-- Staff need to read the whole log; customers only their own rows.
--
-- The drop of the *old* name above is not enough for a re-run. `orders_read` is
-- a new name, so nothing removes the copy this migration created the first time
-- it ran, and the second run of supabase/apply-all.sql aborts with
-- `policy "orders_read" for table "orders" already exists`. Since apply-all.sql
-- is documented as an idempotent installer, it has to drop what it creates.
drop policy if exists "orders_owner_read" on public.orders;
drop policy if exists "orders_read" on public.orders;
create policy "orders_read"
  on public.orders for select
  using (auth.uid() = user_id or public.is_staff_or_admin());

-- Admin-only insert/delete stay as they were: an order is created by its
-- owner at checkout, and admins keep the ability to remove a duplicate.
drop policy if exists "orders_owner_insert" on public.orders;
create policy "orders_owner_insert"
  on public.orders for insert
  with check (auth.uid() = user_id);

-- Line items are part of the dispatch log, so admins lose the ability to
-- rewrite or delete them as well. They remain readable and insertable with
-- their parent order.
drop policy if exists "order_items_admin_mutate" on public.order_items;

drop policy if exists "order_items_read_via_order" on public.order_items;
create policy "order_items_read_via_order"
  on public.order_items for select
  using (
    exists (
      select 1 from public.orders o
      where o.id = order_id
        and (o.user_id = auth.uid() or public.is_staff_or_admin())
    )
  );

drop policy if exists "order_items_insert_via_order" on public.order_items;
create policy "order_items_insert_via_order"
  on public.order_items for insert
  with check (
    exists (
      select 1 from public.orders o
      where o.id = order_id
        and (o.user_id = auth.uid() or public.is_staff_or_admin())
    )
  );

revoke update, delete on public.order_items from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. Staff-only dispatch transitions.
--
-- Terminal states are final, and a cancellation request is cleared once staff
-- act on it. Every change is attributed to the staff member who made it.
-- ---------------------------------------------------------------------------
create or replace function public.set_order_status(
  p_order_id uuid,
  p_status   text,
  p_note     text default null
)
returns public.orders
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_role text;
  current_row public.orders;
  updated     public.orders;
begin
  -- The whole point of this function: role is read from the database, not from
  -- anything the caller sent. An admin is rejected here even though the admin
  -- is allowed to read the log.
  select my_profile_role() into actor_role;

  if actor_role is distinct from 'staff' then
    raise exception 'only staff may update dispatch status (you are %)',
      coalesce(actor_role, 'not signed in')
      using errcode = '42501';
  end if;

  if p_status not in ('placed', 'contacted', 'dispatched', 'delivered', 'cancelled') then
    raise exception 'unknown dispatch status %', p_status using errcode = '22023';
  end if;

  select * into current_row from public.orders where id = p_order_id for update;

  if current_row.id is null then
    raise exception 'order % not found', p_order_id using errcode = 'P0002';
  end if;

  if current_row.status in ('delivered', 'cancelled') then
    raise exception 'order % is % and can no longer change', current_row.reference, current_row.status
      using errcode = '22023';
  end if;

  -- Keep the history honest: only move forward, with cancellation as the way out.
  if p_status <> 'cancelled' then
    if current_row.status = 'dispatched' and p_status in ('placed', 'contacted') then
      raise exception 'order % has already been dispatched', current_row.reference
        using errcode = '22023';
    end if;
  end if;

  update public.orders
     set status            = p_status,
         status_note       = nullif(btrim(coalesce(p_note, '')), ''),
         status_updated_at = now(),
         status_updated_by = auth.uid(),
         contacted_at      = case when p_status = 'contacted' then coalesce(contacted_at, now()) else contacted_at end,
         dispatched_at     = case when p_status = 'dispatched' then coalesce(dispatched_at, now()) else dispatched_at end,
         delivered_at      = case when p_status = 'delivered' then coalesce(delivered_at, now()) else delivered_at end,
         cancel_requested  = case when p_status = 'cancelled' then false else cancel_requested end
   where id = p_order_id
   returning * into updated;

  return updated;
end;
$$;

revoke all on function public.set_order_status(uuid, text, text) from public, anon;
grant execute on function public.set_order_status(uuid, text, text) to authenticated;

comment on function public.set_order_status(uuid, text, text) is
  'Staff-only dispatch transition. Rejects admins and non-staff callers in the '
  'database, so the read-only admin view cannot be bypassed by crafting a request.';

-- ---------------------------------------------------------------------------
-- 5. Customers can ask to cancel, but only while it is still sensible.
-- ---------------------------------------------------------------------------
create or replace function public.request_order_cancellation(p_order_id uuid)
returns public.orders
language plpgsql
security definer
set search_path = public
as $$
declare
  current_row public.orders;
  updated     public.orders;
begin
  if auth.uid() is null then
    raise exception 'sign in to request a cancellation' using errcode = '42501';
  end if;

  select * into current_row from public.orders where id = p_order_id for update;

  if current_row.id is null then
    raise exception 'order % not found', p_order_id using errcode = 'P0002';
  end if;

  if current_row.user_id <> auth.uid() then
    -- Deliberately the same error as "not found", so this cannot be used to
    -- probe for the existence of somebody else's order.
    raise exception 'order % not found', p_order_id using errcode = 'P0002';
  end if;

  if current_row.status in ('dispatched', 'delivered', 'cancelled') then
    raise exception 'order % is already %', current_row.reference, current_row.status
      using errcode = '22023';
  end if;

  if current_row.cancel_requested then
    return current_row;
  end if;

  update public.orders
     set cancel_requested = true
   where id = p_order_id
   returning * into updated;

  return updated;
end;
$$;

revoke all on function public.request_order_cancellation(uuid) from public, anon;
grant execute on function public.request_order_cancellation(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. Staff sign-in gate.
--
-- A suspended or still-invited account must not reach the dispatch log even
-- though its role says staff. is_active and status are checked here so the
-- frontend and the database agree.
-- ---------------------------------------------------------------------------
create or replace function public.can_use_staff_console()
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  p public.profiles;
begin
  select * into p from public.profiles where id = auth.uid();

  if p.id is null then
    return false;
  end if;

  return p.role in ('staff', 'admin') and p.is_active and p.status = 'active';
end;
$$;

revoke all on function public.can_use_staff_console() from public, anon;
grant execute on function public.can_use_staff_console() to authenticated;

notify pgrst, 'reload schema';
