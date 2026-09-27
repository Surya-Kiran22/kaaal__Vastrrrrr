-- ===========================================================================
-- Kaal Vastr — 012 realtime publication
--
-- The project shipped with an empty `supabase_realtime` publication, so
-- postgres_changes subscriptions had nothing to attach to. Adding the tables
-- lets the orders log, dispatch status, stock levels and staff list update
-- themselves with no refresh button and no polling.
--
-- Realtime honours row level security: a customer subscribing to `orders`
-- receives only their own rows, and an anonymous subscriber receives none.
-- Nothing here widens who can read what.
--
-- REPLICA IDENTITY FULL is not set on purpose. The client subscribes to row
-- changes to trigger a refetch; it does not need the old row, and FULL would
-- make the WAL carry every previous version of each order.
-- ===========================================================================

do $$
declare
  target text;
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    -- Should not happen on Supabase, but the scripts are also documented as
    -- runnable from the SQL editor.
    execute 'create publication supabase_realtime';
  end if;

  foreach target in array array[
    'public.orders',
    'public.order_items',
    'public.products',
    'public.profiles',
    'public.business_settings'
  ] loop
    if not exists (
      select 1
        from pg_publication_tables
       where pubname = 'supabase_realtime'
         and schemaname || '.' || tablename = target
    ) then
      execute format('alter publication supabase_realtime add table %s', target);
    end if;
  end loop;
end;
$$;

comment on publication supabase_realtime is
  'Kaal Vastr live tables. RLS applies to every subscriber.';

notify pgrst, 'reload schema';
