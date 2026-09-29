-- ===========================================================================
-- Kaal Vastr — 020 database lint cleanup
--
-- This clears the Supabase advisor warnings that can be cleared *without
-- breaking the storefront*. It deliberately does not revoke EXECUTE from every
-- SECURITY DEFINER function the advisor flags, because most of those warnings
-- are wrong for this schema. The reasoning is written out inline at each step
-- so the next person does not "fix" them and take the shop down.
--
-- The warnings fall into four groups:
--
--   1. function_search_path_mutable      -> FIXED (step 1)
--   2. extension_in_public               -> FIXED (step 2)
--   3. public_bucket_allows_listing      -> FIXED (step 3)
--   4. *_security_definer_function_executable -> PARTIALLY FIXED (step 4),
--      with the rest deliberately left alone (step 5).
--
-- Ordering note: this must be applied *after* 019, and the app deploy must wait
-- for this to land, because step 3 changes storage policies the app relies on.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Mutable search_path
--
-- ALTER FUNCTION ... SET is used rather than CREATE OR REPLACE on purpose. It
-- pins the search path at call time without having to reproduce a function
-- body, so there is no chance of silently changing logic while fixing a
-- warning. It also works on `export_kv_data`, which is not defined anywhere in
-- this repository and therefore could not be safely rewritten.
--
-- `public` is kept first so bare table references still resolve; `pg_temp` is
-- appended because a SECURITY DEFINER function must never be hijacked through
-- a caller-controlled temp schema.
-- ---------------------------------------------------------------------------
-- The signatures are resolved from pg_proc rather than hard-coded. Guessing
-- `export_kv_data()` from its name is not safe -- it is absent from this
-- repository entirely, so its real argument list is unknown -- and a wrong
-- guess would abort the whole migration. Iterating regprocedure also covers
-- every overload of a name if one is ever added.
do $$
declare
  fn text;
begin
  for fn in
    select p.oid::regprocedure::text
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in (
             'set_updated_at',
             'products_compare_price_is_valid',
             'products_sync_total_stock',
             'products_variant_stock_is_valid',
             'export_kv_data'
           )
  loop
    execute format('alter function %s set search_path = public, pg_temp', fn);
  end loop;
end
$$;

-- ---------------------------------------------------------------------------
-- 2. pg_trgm out of the public schema
--
-- The extension is genuinely used: products_name_trgm_idx and the description
-- index are both built on gin_trgm_ops, so this cannot be simply dropped. The
-- indexes are dropped and recreated because the opclass has to be re-resolved
-- in its new schema.
-- ---------------------------------------------------------------------------
create schema if not exists extensions;

do $$
begin
  -- Only relocate if it is still sitting in public; re-running is a no-op.
  if exists (
    select 1
      from pg_extension e
      join pg_namespace n on n.oid = e.extnamespace
     where e.extname = 'pg_trgm'
       and n.nspname = 'public'
  ) then
    execute 'alter extension pg_trgm set schema extensions';
  end if;
end
$$;

drop index if exists public.products_name_trgm_idx;
drop index if exists public.products_description_trgm_idx;

create index if not exists products_name_trgm_idx
  on public.products using gin (name extensions.gin_trgm_ops);

create index if not exists products_description_trgm_idx
  on public.products using gin (description extensions.gin_trgm_ops);

-- ---------------------------------------------------------------------------
-- 3. Public buckets no longer allow listing
--
-- A public bucket serves objects by URL with no SELECT policy at all, so the
-- broad `using (bucket_id = ...)` policies were granting every visitor the
-- ability to *enumerate* every file name, which is not something the storefront
-- needs. Nothing in the app lists storage objects -- products and avatars are
-- only ever read through getPublicUrl -- so the public read policies are
-- replaced with scoped ones.
-- ---------------------------------------------------------------------------
drop policy if exists "product_images_public_read" on storage.objects;
create policy "product_images_admin_read"
  on storage.objects for select
  to authenticated
  using (bucket_id = 'product-images' and public.is_admin());

drop policy if exists "profile_avatars_public_read" on storage.objects;
create policy "profile_avatars_owner_read"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'profile-avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- ---------------------------------------------------------------------------
-- 4. SECURITY DEFINER functions that really are over-exposed
--
-- These four are neither called by the browser app nor referenced by any RLS
-- policy, so removing EXECUTE from anon/authenticated breaks nothing:
--
--   can_use_staff_console       helper only; the app derives console access
--                                client-side from the profile
--   new_order_reference         called solely from the orders BEFORE INSERT
--                                trigger, which runs as the table owner
--   promote_to_admin            used by scripts/manage-staff.mjs via
--                                service_role, never from a browser
--   export_kv_data              a full data dump, callable with no arguments;
--                                leaving this on anon is a genuine leak
-- ---------------------------------------------------------------------------
-- Resolved from pg_proc for the same reason as step 1: `export_kv_data`'s
-- signature is not recorded in this repository, and these names may carry
-- overloads.
do $$
declare
  fn text;
begin
  for fn in
    select p.oid::regprocedure::text
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in (
             'can_use_staff_console',
             'new_order_reference',
             'promote_to_admin',
             'export_kv_data'
           )
  loop
    execute format('revoke all on function %s from public, anon, authenticated', fn);
  end loop;
end
$$;

-- ---------------------------------------------------------------------------
-- 5. Deliberately NOT revoked
--
-- The advisor also flags these. Revoking them is what the warning text
-- suggests, and doing so would break live features. Each one is called as the
-- *querying* role from a row-level policy, so the role needs EXECUTE:
--
--   is_admin()               used by products_admin_read_all, a SELECT policy.
--                             Anonymous visitors SELECT products, and Postgres
--                             must evaluate every SELECT policy to OR them
--                             together. Revoking from anon makes every public
--                             product read fail with "permission denied for
--                             function is_admin" -- an empty shop.
--
--   is_staff_or_admin()      used by the orders read policy alongside
--                             auth.uid() = user_id. Revoking it from
--                             authenticated breaks the order history pages.
--
--   my_profile_role()        used by the profiles read policy
--   my_profile_is_active()   (migration 00200 lines 155-156). Migration 00900
--                             already revoked these from `authenticated`, which
--                             would have undone the explicit grant in 00200 and
--                             locked staff out of their own profile row. That
--                             revoke appears never to have run in production,
--                             which is why the warnings are still firing.
--
-- These four are the app's own RPCs and are exposed on purpose. They already
-- re-check authorisation internally, so the exposure is not the risk the
-- warning describes:
--
--   place_order                    checks auth.uid() is not null
--   request_order_cancellation     checks auth.uid() and that the caller owns
--                                  the order
--   set_account_role               checks public.is_admin()
--   set_order_status               checks my_profile_role() is staff
--
-- Revoking EXECUTE on these would break checkout, cancellations, staff account
-- management and dispatch updates. The advisor warning is expected here.
-- ---------------------------------------------------------------------------

notify pgrst, 'reload schema';
