-- ===========================================================================
-- 02100 - move RLS helper functions out of the PostgREST-exposed schema
--
-- WHY
--   Migration 020 deliberately left these four SECURITY DEFINER functions in
--   `public` and left their advisor warnings standing, because the only two
--   options considered at the time were "revoke EXECUTE" and "switch to
--   SECURITY INVOKER". Both are breakages here:
--
--     * revoke EXECUTE  -> `products_admin_read_all` is a SELECT policy that
--       calls `is_admin()`. Anonymous visitors read products, so losing EXECUTE
--       fails every public read. Empty storefront.
--     * SECURITY INVOKER -> the helpers exist precisely to read `profiles`
--       (which has RLS) while already inside a policy. Invoker rights would
--       recurse.
--
--   The advisor's third option was not used: move the function out of the
--   exposed API schema. PostgREST only exposes `public`, so a function in a
--   private schema is not callable via /rest/v1/rpc/<name> at all, while RLS
--   policy evaluation is server-side and does not care what schema a function
--   lives in. That clears the lint without changing behaviour.
--
-- WHAT THIS CLEARS
--   anon_security_definer_function_executable:      is_admin, is_staff_or_admin
--   authenticated_security_definer_function_executable: is_admin,
--       is_staff_or_admin, my_profile_role, my_profile_is_active
--   = 6 warnings.
--
-- WHAT IT DELIBERATELY DOES NOT TOUCH
--   place_order, request_order_cancellation, set_account_role, set_order_status
--   These are the application's own RPCs. They must stay in `public` or the
--   browser cannot call them, and they must stay SECURITY DEFINER because they
--   write rows the user has no direct grant on. They re-check authorisation
--   internally (auth.uid(), order ownership, is_admin(), my_profile_role()), so
--   the four residual warnings are by design, not debt.
--
-- SAFETY
--   Supabase's SQL Editor runs this whole script as one transaction, so any
--   error rolls the entire thing back. On top of that, step 5 asserts that no
--   policy or function still references the old public.* copies and raises an
--   exception if any do. A partial sweep therefore aborts instead of leaving
--   policies pointing at functions that no longer exist.
-- ===========================================================================


-- 1. Private schema + the four helpers, duplicated here under new names so the
--    originals keep working until every caller has been repointed.
create schema if not exists private;

create or replace function private.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.profiles
    where id = auth.uid()
      and role = 'admin'
      and is_active
  );
$$;

create or replace function private.is_staff_or_admin()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.profiles
    where id = auth.uid()
      and role in ('admin', 'staff')
      and is_active
  );
$$;

create or replace function private.my_profile_role()
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select role
  from public.profiles
  where id = auth.uid();
$$;

create or replace function private.my_profile_is_active()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(
    (select is_active from public.profiles where id = auth.uid()),
    false
  );
$$;

comment on schema private is
  'Internal helpers. Not exposed through PostgREST. RLS policies and SECURITY '
  'DEFINER functions reference these instead of the public.* originals.';


-- 2. Repoint every RLS policy. Mechanical text substitution, so no policy has
--    to be restated by hand and none can be silently missed.
do $$
declare
  r record;
  v_qual text;
  v_check text;
  v_hit integer;
begin
  for r in
    select schemaname, tablename, policyname,
           coalesce(qual, '')       as qual,
           coalesce(with_check, '') as with_check
    from pg_policies
    where schemaname in ('public', 'storage')
      and ( qual ~ 'public\.(is_admin|is_staff_or_admin|my_profile_role|my_profile_is_active)\(\)'
         or with_check ~ 'public\.(is_admin|is_staff_or_admin|my_profile_role|my_profile_is_active)\(\)' )
  loop
    v_qual := r.qual;
    v_qual := replace(v_qual, 'public.is_admin()',             'private.is_admin()');
    v_qual := replace(v_qual, 'public.is_staff_or_admin()',    'private.is_staff_or_admin()');
    v_qual := replace(v_qual, 'public.my_profile_role()',      'private.my_profile_role()');
    v_qual := replace(v_qual, 'public.my_profile_is_active()', 'private.my_profile_is_active()');

    v_check := r.with_check;
    v_check := replace(v_check, 'public.is_admin()',             'private.is_admin()');
    v_check := replace(v_check, 'public.is_staff_or_admin()',    'private.is_staff_or_admin()');
    v_check := replace(v_check, 'public.my_profile_role()',      'private.my_profile_role()');
    v_check := replace(v_check, 'public.my_profile_is_active()', 'private.my_profile_is_active()');

    if r.with_check = '' then
      -- SELECT-only policy: ALTER POLICY rejects an empty WITH CHECK.
      execute format('alter policy %I on %I.%I using (%s)',
                     r.policyname, r.schemaname, r.tablename, v_qual);
    else
      execute format('alter policy %I on %I.%I using (%s) with check (%s)',
                     r.policyname, r.schemaname, r.tablename, v_qual, v_check);
    end if;

    get diagnostics v_hit = row_count;
    raise notice 'repointed policy %.% -> %.%', r.tablename, r.policyname, r.tablename, r.policyname;
  end loop;
end $$;


-- 3. Repoint SECURITY DEFINER function bodies that call the helpers from
--    inside. pg_get_functiondef returns a full CREATE OR REPLACE statement, so
--    executing the rewritten text re-creates the function in place with an
--    unchanged signature and unchanged grants.
do $$
declare
  r record;
begin
  for r in
    select p.oid,
           pg_get_functiondef(p.oid) as def
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prosrc ~ '(is_admin|is_staff_or_admin|my_profile_role|my_profile_is_active)\(\)'
  loop
    v_def := r.def;
    v_def := replace(v_def, 'public.is_admin()',             'private.is_admin()');
    v_def := replace(v_def, 'public.is_staff_or_admin()',    'private.is_staff_or_admin()');
    v_def := replace(v_def, 'public.my_profile_role()',      'private.my_profile_role()');
    v_def := replace(v_def, 'public.my_profile_is_active()', 'private.my_profile_is_active()');

    if v_def <> r.def then
      execute v_def;
      raise notice 'repointed a function body that calls the helpers';
    end if;
  end loop;
end $$;


-- 4. Repoint any *unqualified* call inside function bodies too, e.g.
--    `select my_profile_role() into actor_role;` in the dispatch helpers.
--    These only need qualifying if public.* is about to be dropped.
do $$
declare
  r record;
  v_def text;
begin
  for r in
    select p.oid, pg_get_functiondef(p.oid) as def
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prosrc ~ '(^|[^.\w])(is_admin|is_staff_or_admin|my_profile_role|my_profile_is_active)\(\s*\)'
  loop
    -- Sequential statements rather than nested replace() calls: the parentheses
    -- stay auditable, and a typo fails loudly instead of silently.
    v_def := r.def;
    v_def := replace(v_def, ' is_admin()',             ' private.is_admin()');
    v_def := replace(v_def, ' is_staff_or_admin()',    ' private.is_staff_or_admin()');
    v_def := replace(v_def, ' my_profile_role()',      ' private.my_profile_role()');
    v_def := replace(v_def, ' my_profile_is_active()', ' private.my_profile_is_active()');
    v_def := replace(v_def, '(is_admin()',             '(private.is_admin()');
    v_def := replace(v_def, '(is_staff_or_admin()',    '(private.is_staff_or_admin()');
    v_def := replace(v_def, '(my_profile_role()',      '(private.my_profile_role()');
    v_def := replace(v_def, '(my_profile_is_active()', '(private.my_profile_is_active()');

    if v_def <> r.def then
      execute v_def;
      raise notice 'qualified an unqualified helper call in a function body';
    end if;
  end loop;
end $$;


-- 5. Abort rather than leave a half-migrated database. If any policy or
--    function still names the public.* copies, dropping them below would make
--    that reference dangle and RLS would fail at query time.
do $$
declare
  v_left integer;
  v_body integer;
begin
  select count(*) into v_left
  from pg_policies
  where schemaname in ('public', 'storage')
    and ( qual ~ 'public\.(is_admin|is_staff_or_admin|my_profile_role|my_profile_is_active)\(\)'
       or with_check ~ 'public\.(is_admin|is_staff_or_admin|my_profile_role|my_profile_is_active)\(\)' );

  -- Function bodies matter too. The helpers they call are dropped in step 6, and
  -- a body left calling `my_profile_role()` unqualified would still resolve
  -- through its own search_path at call time and then fail.
  select count(*) into v_body
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname in ('public', 'private')
    and p.prosrc ~ 'public\.(is_admin|is_staff_or_admin|my_profile_role|my_profile_is_active)\(\)';

  if v_left > 0 or v_body > 0 then
    raise exception
      'aborting: % RLS policies and % function bodies still reference the public.* helpers',
      v_left, v_body;
  end if;
end $$;


-- 6. Drop the exposed copies. This is what actually clears the lint, because
--    /rest/v1/rpc/is_admin stops resolving.
drop function if exists public.is_admin();
drop function if exists public.is_staff_or_admin();
drop function if exists public.my_profile_role();
drop function if exists public.my_profile_is_active();


-- 7. Policies are evaluated as the querying role, so that role still needs
--    EXECUTE plus USAGE on the schema. Note this deliberately re-grants EXECUTE
--    to anon: without it, every anonymous product read fails RLS.
grant usage on schema private to anon, authenticated;

grant execute on function private.is_admin()             to anon, authenticated;
grant execute on function private.is_staff_or_admin()    to anon, authenticated;
grant execute on function private.my_profile_role()      to authenticated;
grant execute on function private.my_profile_is_active() to authenticated;

revoke all on function private.is_admin()             from public;
revoke all on function private.is_staff_or_admin()    from public;
revoke all on function private.my_profile_role()      from public;
revoke all on function private.my_profile_is_active() from public;


-- Reload PostgREST's cached schema so /rest/v1 stops advertising the dropped
-- functions.
notify pgrst, 'reload schema';


-- ===========================================================================
-- AFTER RUNNING: re-check Database > Lint. Expect the six SECURITY DEFINER
-- warnings above to be gone. The four that remain (place_order,
-- request_order_cancellation, set_account_role, set_order_status) are the
-- application's own RPCs and cannot be moved without breaking the shop.
--
-- Separately, enable Leaked Password Protection under
-- Authentication > Providers > Email. That one is a dashboard toggle, not SQL.
--
-- Sanity check after this migration, run signed OUT - it must return products:
--   select id from public.products where is_archived = false limit 3;
-- If that returns nothing, the product read policy lost its admin branch and
-- this migration should be rolled back.
-- ===========================================================================
