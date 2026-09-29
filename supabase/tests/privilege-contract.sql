-- ===========================================================================
-- Kaal Vastr - table privilege contract
--
-- Reports the table-level GRANT surface for the tables the app writes to, and
-- exits non-zero if any critical check fails.
--
--   psql "$KV_DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/privilege-contract.sql
--
-- Read-only: this file only queries pg_class / pg_roles / pg_policies. It
-- writes nothing, so unlike place_order.sql it is safe to point at production.
--
-- Why this exists
-- ---------------
-- 015 ended with `revoke all on public.products` and re-granted only select and
-- update. Postgres evaluates table-level privilege BEFORE row-level security, so
-- the correct `with check (is_admin())` insert policy could not rescue the
-- missing grant, and creating a product failed with:
--
--     ERROR:  permission denied for table products
--
-- Nothing caught it because reading, editing, archiving, feature-toggling and
-- availability-toggling all still worked. Only create and hard delete were
-- broken, and those are the two paths a smoke test is least likely to click.
--
-- The other failure this guards is a grant with no policy behind it: a blanket
-- `grant all to authenticated` would also clear the insert error, and would do
-- it by opening the catalogue to every signed-in shopper. So the report prints
-- the RLS policy that narrows each writable table, for a human to read.
-- ===========================================================================
\set ON_ERROR_STOP on
\timing off

-- ---------------------------------------------------------------------------
-- Report: the full table-level grant surface.
-- ---------------------------------------------------------------------------
select
  r.rolname as role,
  t.relname as table,
  string_agg(p.priv::text, ', ' order by p.priv::text) as table_level_privileges
from pg_class t
join pg_namespace n
  on n.oid = t.relnamespace and n.nspname = 'public'
cross join pg_roles r
cross join lateral (
  select 'SELECT'::text as priv, 1 as ord where has_table_privilege(r.oid, t.oid, 'SELECT')
  union all
  select 'INSERT', 2 where has_table_privilege(r.oid, t.oid, 'INSERT')
  union all
  select 'UPDATE', 3 where has_table_privilege(r.oid, t.oid, 'UPDATE')
  union all
  select 'DELETE', 4 where has_table_privilege(r.oid, t.oid, 'DELETE')
) p
where t.relkind = 'r'
  and r.rolname in ('anon', 'authenticated')
  and t.relname in ('products', 'business_settings', 'orders', 'order_items', 'addresses')
group by r.rolname, t.relname
order by t.relname, r.rolname;

-- ---------------------------------------------------------------------------
-- Report: which RLS policy narrows each writable table. A table-level grant is
-- only safe while one of these is admin-gated.
-- ---------------------------------------------------------------------------
select
  tablename,
  cmd,
  coalesce(nullif(qual, ''), '-') as using_clause,
  coalesce(nullif(with_check, ''), '-') as check_clause
from pg_policies
where schemaname = 'public'
  and tablename in ('products', 'business_settings')
order by tablename, cmd;

-- ---------------------------------------------------------------------------
-- Critical assertions. Each \gset pulls one boolean into a psql variable, and
-- \quit 1 fails the run. Kept to plain psql so there is no PL/pgSQL here to
-- misbehave on a database we cannot rehearse against.
-- ---------------------------------------------------------------------------

-- 018 restores these; all three regressed at once in 015.
select has_table_privilege('authenticated', 'INSERT', 'public.products') as ok \gset
\if :ok
\else
  \echo 'FAIL  authenticated cannot INSERT products -> product creation is broken'
  \quit 1
\endif

select has_table_privilege('authenticated', 'DELETE', 'public.products') as ok \gset
\if :ok
\else
  \echo 'FAIL  authenticated cannot DELETE products -> hard delete is broken'
  \quit 1
\endif

-- The admin settings form uses upsert(), which needs INSERT privilege even when
-- the ON CONFLICT branch is the one that fires.
select has_table_privilege('authenticated', 'INSERT', 'public.business_settings') as ok \gset
\if :ok
\else
  \echo 'FAIL  authenticated cannot INSERT business_settings -> the upsert() in the settings form cannot run'
  \quit 1
\endif

-- 015's original invariant: set_order_status() is the only writer of
-- order.status, so nobody gets table-level UPDATE on orders.
select has_table_privilege('authenticated', 'UPDATE', 'public.orders') as ok \gset
\if :ok
  \echo 'FAIL  authenticated has table-level UPDATE on orders -> anyone signed in can PATCH status and bypass set_order_status()'
  \quit 1
\endif

-- Anonymous must stay read-only everywhere.
select
  has_table_privilege('anon', 'INSERT', 'public.products')
  or has_table_privilege('anon', 'UPDATE', 'public.products')
  or has_table_privilege('anon', 'DELETE', 'public.products') as ok \gset
\if :ok
  \echo 'FAIL  anon has a write privilege on products'
  \quit 1
\endif

-- A grant is only acceptable while an admin-gated policy narrows it.
select exists (
  select 1 from pg_policies
  where schemaname = 'public' and tablename = 'products'
    and cmd = 'INSERT' and with_check like '%is_admin%'
) as ok \gset
\if :ok
\else
  \echo 'FAIL  products INSERT is granted but no admin-gated RLS policy narrows it'
  \quit 1
\endif

select exists (
  select 1 from pg_policies
  where schemaname = 'public' and tablename = 'business_settings'
    and cmd = 'INSERT' and with_check like '%is_admin%'
) as ok \gset
\if :ok
\else
  \echo 'FAIL  business_settings INSERT is granted but no admin-gated RLS policy narrows it'
  \quit 1
\endif

\echo 'privilege contract OK'
