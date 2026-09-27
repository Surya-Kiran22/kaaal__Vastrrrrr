-- ===========================================================================
-- Kaal Vastr — 013 self-service column limits, monotonic dispatch, honest
--               error codes
--
-- Found by scripts/verify-staff-dispatch.mjs against the live database.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. A profile may only edit its own name and phone.
--
-- profiles_update_own is scoped by row, not by column, so any signed-in
-- account could previously PATCH its own row. Two consequences, both bad:
--
--   * an unverified staff member could set email_verified_at and appear in the
--     admin's staff list as verified without ever entering a code;
--   * a SUSPENDED staff member could set status = 'active', is_active = true
--     and suspended_at = null, which is exactly what can_use_staff_console()
--     checks -- a self-reinstatement that the role guard never sees, because
--     that trigger only fires on changes to `role`.
--
-- Role and suspension are changed exclusively through set_account_role() and
-- promote_to_admin(), which re-check the caller's role as admin.
-- ---------------------------------------------------------------------------
revoke update on public.profiles from anon, authenticated;
grant update (full_name, phone) on public.profiles to authenticated;

comment on column public.profiles.email_verified_at is
  'Mirrored from auth.users.email_confirmed_at by a trigger. Not client '
  'writable: only full_name and phone are self-service.';

-- ---------------------------------------------------------------------------
-- 2. Dispatch status only moves forward.
--
-- The previous guard blocked dispatched -> placed/contacted but allowed
-- contacted -> placed, so a staff member could quietly reset an order's
-- progress and lose the contacted_at trail. Status now has a rank and may only
-- increase, except for cancellation, which is always allowed until terminal.
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
  actor_role   text;
  current_row  public.orders;
  updated      public.orders;
  current_rank integer;
  target_rank  integer;
begin
  -- Role comes from the database, never from the request. This is what makes
  -- the admin view genuinely read-only rather than merely read-only in the UI.
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

  -- 42501 rather than P0002: PostgREST reports an unrecognised SQLSTATE as
  -- HTTP 500, which reads as a server fault in the UI. 403 also avoids
  -- confirming whether somebody else's order exists.
  if current_row.id is null then
    raise exception 'order not found' using errcode = '42501';
  end if;

  if current_row.status in ('delivered', 'cancelled') then
    raise exception 'order % is % and can no longer change',
      current_row.reference, current_row.status
      using errcode = '22023';
  end if;

  current_rank := case current_row.status
    when 'placed' then 1
    when 'contacted' then 2
    when 'dispatched' then 3
    when 'delivered' then 4
  end;

  target_rank := case p_status
    when 'placed' then 1
    when 'contacted' then 2
    when 'dispatched' then 3
    when 'delivered' then 4
  end;

  if p_status <> 'cancelled' and target_rank <= current_rank then
    raise exception 'order % is already %; it cannot go back to %',
      current_row.reference, current_row.status, p_status
      using errcode = '22023';
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

-- ---------------------------------------------------------------------------
-- 3. Same error-code treatment for the customer-facing cancellation request.
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

  select * into current_row
    from public.orders where id = p_order_id for update;

  -- One message for "no such order" and "not your order", so this cannot be
  -- used to discover that somebody else's order reference exists.
  if current_row.id is null or current_row.user_id <> auth.uid() then
    raise exception 'order not found' using errcode = '42501';
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
-- 4. Staff must not appear in the admin staff list as verified unless the
--    database says so. Belt and braces: the admin screen reads
--    email_verified_at, which is now not writable by anyone but the trigger.
-- ---------------------------------------------------------------------------
revoke insert, update, delete on public.profiles from anon, authenticated;

notify pgrst, 'reload schema';
