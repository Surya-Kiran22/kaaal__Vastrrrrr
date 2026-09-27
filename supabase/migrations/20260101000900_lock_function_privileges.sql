-- ===========================================================================
-- Kaal Vastr — 009 lock down function execution privileges
--
-- Supabase's default privileges grant EXECUTE on every new function in the
-- public schema to PUBLIC (and therefore to anon and authenticated). Most of
-- this schema's functions are SECURITY DEFINER triggers, which have no reason
-- to be callable by a request at all:
--
--   handle_new_user, set_updated_at, products_sync_total_stock,
--   products_variant_stock_is_valid, products_compare_price_is_valid,
--   addresses_assign_owner, addresses_keep_single_default,
--   orders_assign_owner, order_items_recalc_order
--
-- Calling a trigger function directly cannot corrupt anything (the `new`
-- record is unassigned, so it errors), but it is needless surface area, and
-- `is_admin()` / `is_staff_or_admin()` genuinely are callable zero-argument
-- SECURITY DEFINER functions.
--
-- The RLS helper functions are the deliberate exception. Policies are OR'd
-- together, so if the querying role cannot execute a function referenced by
-- *any* policy the entire statement fails with permission denied. Public
-- product reads depend on that, so the helpers stay executable by the roles
-- whose policies call them, and nothing more.
--
-- Extension-owned functions (pg_trgm) are left untouched.
-- ===========================================================================

-- Trigger and maintenance functions: no role needs to call these directly.
-- PostgreSQL does not re-check EXECUTE when it fires a trigger, so revoking
-- here cannot break the triggers themselves.
do $$
declare
  fn record;
begin
  for fn in
    select p.oid::regprocedure as signature
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = any (array[
        'handle_new_user',
        'set_updated_at',
        'products_sync_total_stock',
        'products_variant_stock_is_valid',
        'products_compare_price_is_valid',
        'addresses_assign_owner',
        'addresses_keep_single_default',
        'orders_assign_owner',
        'order_items_recalc_order'
      ])
  loop
    execute format('revoke all on function %s from public, anon, authenticated', fn.signature);
  end loop;
end;
$$;

-- RLS helpers. These are referenced inside row level security policies, so the
-- role running the query must be able to execute them.
revoke all on function public.is_admin()                from public, anon, authenticated;
revoke all on function public.is_staff_or_admin()       from public, anon, authenticated;
grant execute on function public.is_admin()             to anon, authenticated;
grant execute on function public.is_staff_or_admin()    to anon, authenticated;

revoke all on function public.my_profile_role()         from public, anon, authenticated;
revoke all on function public.my_profile_is_active()    from public, anon, authenticated;
grant execute on function public.my_profile_role()      to authenticated;
grant execute on function public.my_profile_is_active() to authenticated;

-- `promote_to_admin` is deliberately absent here. It is created by migration
-- 010, which also does its own revoke/grant. Granting it from this migration
-- would fail on a clean install, where the function does not exist yet.

revoke all on function public.new_order_reference()     from public, anon, authenticated;
grant execute on function public.new_order_reference()  to authenticated;

notify pgrst, 'reload schema';
