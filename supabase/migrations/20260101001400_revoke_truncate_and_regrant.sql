-- ===========================================================================
-- Kaal Vastr — 014 remove TRUNCATE / TRIGGER / REFERENCES from client roles
--
-- Found by scripts/verify-staff-dispatch.mjs against the live database.
--
-- Supabase's default privileges grant ALL on every table in the public schema
-- to anon and authenticated, and that includes TRUNCATE. PostgreSQL does NOT
-- apply row level security to TRUNCATE, so the grant is not covered by any of
-- the policies in this schema:
--
--   set role anon; truncate public.business_settings;   -- succeeds
--
-- That empties the table regardless of RLS. It is not reachable through
-- PostgREST, which only speaks SELECT/INSERT/UPDATE/DELETE, so the public REST
-- API is not directly exploitable today. It is still a live landmine for
-- anything that ever executes SQL as anon or authenticated: an RPC, a
-- connection string using the anon role, a future endpoint, or an injection.
--
-- TRIGGER and REFERENCES go for the same reason: anon has no business creating
-- triggers or foreign keys on the catalogue.
--
-- SELECT / INSERT / UPDATE / DELETE are left alone, because those are the
-- privileges RLS is designed to constrain.
-- ===========================================================================

do $$
declare
  tbl text;
begin
  for tbl in
    select quote_ident(tablename) from pg_tables where schemaname = 'public'
  loop
    execute format('revoke truncate, trigger, references on table public.%s from anon, authenticated', tbl);
  end loop;
end;
$$;

-- Storage objects are governed by storage.objects, not a public table, but the
-- same default-privilege problem applies to the storage schema's tables.
do $$
declare
  tbl text;
begin
  if exists (select 1 from pg_namespace where nspname = 'storage') then
    for tbl in
      select quote_ident(tablename) from pg_tables where schemaname = 'storage'
    loop
      execute format('revoke truncate, trigger on table storage.%s from anon, authenticated', tbl);
    end loop;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Self-service profile edits, granted LAST.
--
-- Order matters and was the cause of the previous failure: a table-level
-- REVOKE UPDATE also removes column-level UPDATE grants, so 013's
-- `grant update (full_name, phone)` was undone by its own trailing
-- `revoke insert, update, delete`. Revoke first, then grant.
-- ---------------------------------------------------------------------------
revoke update on public.profiles from anon, authenticated;
grant update (full_name, phone) on public.profiles to authenticated;

-- Customers write their own addresses; staff and admin manage the catalogue.
-- Kept as explicit table-level grants so the intent is readable, and so these
-- survive a future default-privileges change.
grant select, insert, update, delete on public.addresses to authenticated;
grant select, insert, update, delete on public.orders to authenticated;
grant select, insert on public.order_items to authenticated;
grant select on public.products to anon, authenticated;
grant update on public.products to authenticated;
grant select on public.business_settings to anon, authenticated;
grant update on public.business_settings to authenticated;

notify pgrst, 'reload schema';
