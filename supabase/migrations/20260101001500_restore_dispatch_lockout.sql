-- ===========================================================================
-- Kaal Vastr — 015 restore the dispatch lockout
--
-- 014 ended with a tidy-looking summary of intended table privileges:
--
--     grant select, insert, update, delete on public.orders to authenticated;
--
-- which silently undid 011's `revoke update on public.orders`. Table-level
-- UPDATE is a blanket grant, so every authenticated account could once again
-- PATCH orders.status directly and bypass set_order_status() entirely --
-- including the admin, which is precisely what requirement 3 forbids.
--
-- scripts/verify-staff-dispatch.mjs caught it on the next run:
--     FAIL  admin cannot PATCH order status directly  -> status=204
--
-- Order status has exactly one writer: the SECURITY DEFINER set_order_status()
-- function, which re-checks the caller's role. Nobody gets UPDATE on the table.
-- The explicit grants below are the complete intended surface, and the column
-- grants come after the table-level revokes on purpose.
-- ===========================================================================

-- Nobody writes to an order row directly.
revoke insert, update, delete on public.orders from anon, authenticated;
grant select on public.orders to anon, authenticated;
grant insert on public.orders to authenticated;

-- Line items are insertable with their order and readable, never rewritten.
revoke insert, update, delete on public.order_items from anon, authenticated;
grant select on public.order_items to anon, authenticated;
grant insert on public.order_items to authenticated;

-- Customers own their addresses outright.
revoke all on public.addresses from anon;
grant select, insert, update, delete on public.addresses to authenticated;

-- Catalogue: everyone reads, only admins write (row level security decides
-- which admins, and the role guard trigger covers the role column).
revoke all on public.products from anon, authenticated;
grant select on public.products to anon, authenticated;
grant update on public.products to authenticated;

revoke all on public.business_settings from anon, authenticated;
grant select on public.business_settings to anon, authenticated;
grant update on public.business_settings to authenticated;

-- Profiles: readable, and only name and phone are self-writable.
revoke all on public.profiles from anon, authenticated;
grant select on public.profiles to anon, authenticated;
grant update (full_name, phone) on public.profiles to authenticated;

-- The audit trail is admin-readable and written only by SECURITY DEFINER code.
revoke all on public.staff_account_events from anon, authenticated;
grant select on public.staff_account_events to authenticated;

notify pgrst, 'reload schema';
