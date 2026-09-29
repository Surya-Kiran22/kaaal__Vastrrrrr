-- ===========================================================================
-- Kaal Vastr — 018 restore catalogue write privileges
--
-- 015 closed off the catalogue with:
--
--     revoke all on public.products from anon, authenticated;
--     grant select  on public.products to anon, authenticated;
--     grant update  on public.products to authenticated;
--
-- `revoke all` is a blanket revoke, and the two re-grants below it covered
-- only reading and editing. INSERT and DELETE were never restored, so every
-- admin product write that creates or permanently removes a row failed at the
-- permission check before RLS was ever consulted:
--
--     ERROR:  permission denied for table products
--
-- The admin storefront hits this immediately, because creating a product is a
-- plain `.insert()` (useAdminMutations.ts -> useCreateProduct). Archiving and
-- editing existing products kept working, which is why the omission went
-- unnoticed: only the create and hard-delete paths were broken.
--
-- This was never a policy problem. The row-level rules were already correct
-- and have been in place since 002:
--
--     products_admin_insert  ... for insert with check (public.is_admin())
--     products_admin_update  ... for update using / with check (is_admin())
--     products_admin_delete  ... for delete using      (public.is_admin())
--
-- Postgres checks table-level privilege BEFORE row-level security, so a
-- correct `with check (is_admin())` policy cannot rescue a missing GRANT. The
-- policies were written for exactly the surface that the grants withheld.
--
-- The same blanket `revoke all` in 015 also stripped INSERT from
-- business_settings, which is the harder one to spot because the admin
-- settings form uses `.upsert(..., { onConflict: 'id' })`. Postgres requires
-- INSERT privilege to execute an `INSERT ... ON CONFLICT DO UPDATE` even when
-- the conflict branch is the one that fires, so saving settings fails the same
-- way even though the `biz-001` row already exists.
--
-- Anonymous access is unchanged: still SELECT-only, and INSERT/DELETE are
-- revoked again below so this migration is safe to re-run. `authenticated`
-- keeps table-level INSERT/DELETE, but an ordinary signed-in shopper still
-- cannot use them -- the policies above admit `is_admin()` only, so RLS
-- remains the real guard and the grant just stops the permission check from
-- firing first.
-- ===========================================================================

-- Catalogue: readable by everyone, writable by signed-in accounts at the table
-- level, narrowed to admins by products_admin_insert / _update / _delete.
revoke insert, delete on public.products from anon;
grant  select, insert, update, delete on public.products to authenticated;

-- Settings are a single `biz-001` row. INSERT is required by the upsert even
-- though only the conflict branch ever runs; RLS still limits the write to
-- admins via the business_settings policies.
revoke insert on public.business_settings from anon;
grant  select, insert, update on public.business_settings to authenticated;

-- PostgREST caches its schema and prepared statements. This is a no-op for the
-- table grants above but keeps a fresh deploy from serving a stale plan.
notify pgrst, 'reload schema';
