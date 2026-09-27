-- ===========================================================================
-- Kaal Vastr - place_order acceptance checks
--
-- Exercises public.place_order as a signed-in customer, including every way the
-- function is supposed to refuse a request. Run it against a scratch or staging
-- database after applying the migrations; it writes three real orders, so do
-- not point it at production.
--
--   psql "$KV_DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/place_order.sql
--
-- A refusal is only a pass if it was refused FOR THE EXPECTED REASON. The old
-- version of this file caught `when others` and printed the message, so a case
-- that failed early for an unrelated reason still read as "ok, refused" and the
-- run exited 0. expect_refusal() below raises instead, which aborts the file.
--
-- The final count is the other real assertion: a rejected order must leave no
-- rows behind, because the whole point of the function is that a failure rolls
-- back.
-- ===========================================================================
\set ON_ERROR_STOP on
\timing off

-- ---------------------------------------------------------------------------
-- Records a refusal as a pass only when it was refused FOR AN EXPECTED REASON.
--
-- The first version of this file caught `when others` and printed whatever came
-- back, so a case that failed early for an unrelated reason still read as "ok,
-- refused" and the run exited 0. This raises instead, which aborts the file.
--
-- `wanted` is a list because a refusal is legitimate from more than one layer.
-- Removing the INSERT grant and dropping the insert policy are independent
-- changes, and either alone is enough to stop the attack. Asserting on one
-- specific message would make the file fail on a still-safe database, which
-- trains people to ignore it.
--
-- Two PL/pgSQL details are load-bearing:
--
--   * The handler itself must only assign `refusal := sqlerrm;`. A function
--     call directly in an EXCEPTION handler is a syntax error, so the assertion
--     is made after the inner block closes.
--   * It lives in `public`, not `pg_temp`, because this session's search_path is
--     `"$user", public` and an unqualified `pg_temp` call does not resolve.
--     Dropped again at the end of the file.
--
-- One caveat that a failure exposes: `create function` cannot be transactional
-- across the whole file, so a run that aborts part-way leaves this helper
-- behind. It grants nothing on its own, and removing it is one statement:
--   drop function if exists public.expect_refusal(text, text[]);
-- ---------------------------------------------------------------------------
create or replace function public.expect_refusal(got text, wanted text[])
returns void
language plpgsql
as $$
declare
  candidate text;
begin
  if got is null then
    raise exception
      'FAIL: the request was accepted but should have been refused (expected one of: %)',
      array_to_string(wanted, ' / ');
  end if;

  foreach candidate in array wanted
  loop
    if got ilike '%' || candidate || '%' then
      raise notice 'ok, refused: %', got;
      return;
    end if;
  end loop;

  raise exception 'FAIL: refused for the WRONG reason: % (expected one of: %)',
    got, array_to_string(wanted, ' / ');
end;
$$;

-- ---------------------------------------------------------------------------
-- A verified, active customer. handle_new_user has already created the profile
-- by the time this runs, so only the columns the trigger leaves blank are set.
-- `role` is deliberately not touched: profiles_role_guard rightly refuses a role
-- change without an admin behind it.
-- ---------------------------------------------------------------------------
insert into auth.users (id, email, email_confirmed_at)
values ('11111111-1111-1111-1111-111111111111', 'shopper@example.com', now())
on conflict (id) do nothing;

update public.profiles
set full_name = 'Asha Rao', status = 'active', is_active = true, email_verified_at = now()
where id = '11111111-1111-1111-1111-111111111111';

-- auth.uid() reads this, standing in for the JWT claim PostgREST would set.
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', false);
select set_config('request.jwt.claim.role', 'authenticated', false);

-- Nothing is granted to `authenticated` here on purpose.
--
-- This file used to re-create the pre-017 grants by hand because `place_order`
-- was SECURITY INVOKER and needed them. That made the test blind to the exact
-- hole 017 closes: a hand-written grant is a different fact about the database
-- than the one the migrations actually leave behind. The function is now
-- SECURITY DEFINER, so it needs no caller privileges, and the privilege checks
-- further down are only meaningful against the real grant set.
grant usage on schema public to authenticated;

-- One product plus a colour/size combination that is genuinely in stock. The
-- variant is derived from `variant_stock` rather than hard-coded, so the test
-- keeps working when the seed catalogue changes.
create temporary table picked_product as
select p.id,
       p.slug,
       split_part(v.key, '|', 1) as color,
       nullif(split_part(v.key, '|', 2), '') as size
  from public.products p
  cross join lateral (
    -- `variant_stock` maps "Colour|Size" to a bare integer, so the scalar is
    -- unwrapped with #>> '{}' before casting.
    select e.key, e.value
      from jsonb_each(p.variant_stock) as e(key, value)
     where (e.value #>> '{}')::integer > 0
     order by e.key
     limit 1
  ) as v
 where jsonb_typeof(p.variant_stock) = 'object'
 order by p.slug
 limit 1;

\echo ''
\echo 'Using product / variant:'
select slug, color, size from picked_product;

\echo ''
\echo '1. Delivery order, full address ------------------------------------'
select public.place_order(
  jsonb_build_array(jsonb_build_object(
    'product_id', (select id from picked_product), 'color', (select color from picked_product), 'size', (select size from picked_product), 'quantity', 2)),
  '{"full_name":"Asha Rao","phone":"9876543210","line1":"12 MG Road","city":"Pune","state":"Maharashtra","pincode":"411001"}'::jsonb,
  'please call before delivery', null, 'Asha Rao', '9876543210'
) ->> 'reference' as reference;

\echo ''
\echo '2. Pickup order, no address at all ---------------------------------'
-- The storefront allows checkout with nothing saved, and the staff console
-- labels that case "Pickup at store", so a null delivery has to stay legal.
select public.place_order(
  jsonb_build_array(jsonb_build_object(
    'product_id', (select id from picked_product), 'color', (select color from picked_product), 'size', (select size from picked_product), 'quantity', 1)),
  null, 'collecting from store', null, 'Asha Rao', '9876543210'
) ->> 'reference' as reference;

\echo ''
\echo '3. Pickup kept the name and phone even with no address --------------'
select customer_name, customer_phone, delivery is null as delivery_is_null, notes
from public.orders order by created_at desc limit 1;

\echo ''
\echo '4. The database priced the lines, not the client --------------------'
select o.reference, o.item_count, o.subtotal, o.savings, o.total,
       (select count(*) from public.order_items i where i.order_id = o.id) as stored_lines
from public.orders o order by o.created_at desc limit 2;

\echo ''
\echo '5. Stored lines come back, so the WhatsApp text matches the order ----'
select public.place_order(
  jsonb_build_array(jsonb_build_object(
    'product_id', (select id from picked_product), 'color', (select color from picked_product), 'size', (select size from picked_product), 'quantity', 1)),
  null, null, null, 'Asha Rao', '9876543210'
) -> 'items' as items;

\echo ''
\echo '6. Empty cart is refused --------------------------------------------'
-- Baseline taken here, after the three orders that are meant to succeed. Every
-- case below must leave the tables exactly as they are.
create temporary table baseline as
select (select count(*) from public.orders) as orders,
       (select count(*) from public.order_items) as items;

do $$ declare refusal text; begin
  begin
    perform public.place_order('[]'::jsonb, null, null, null, 'Asha', '9876543210');
  exception when others then refusal := sqlerrm; end;
  perform expect_refusal(refusal, array['at least one item']);
end $$;

\echo ''
\echo '7. Half-filled address is refused -----------------------------------'
do $$ declare refusal text; begin
  begin
    perform public.place_order(
      jsonb_build_array(jsonb_build_object(
        'product_id', (select id from picked_product), 'color', (select color from picked_product), 'size', (select size from picked_product), 'quantity', 1)),
      '{"full_name":"Asha","phone":"9876543210","line1":"12 MG Road"}'::jsonb,
      null, null, 'Asha', '9876543210');
  exception when others then refusal := sqlerrm; end;
  perform expect_refusal(refusal, array['delivery address is incomplete']);
end $$;

\echo ''
\echo '8. Unknown product is refused ---------------------------------------'
do $$ declare refusal text; begin
  begin
    perform public.place_order(
      '[{"product_id":"00000000-0000-0000-0000-000000000000","quantity":1}]'::jsonb,
      null, null, null, 'Asha', '9876543210');
  exception when others then refusal := sqlerrm; end;
  perform expect_refusal(refusal, array['no longer available']);
end $$;

\echo ''
\echo '9. A colour/size the product does not stock is refused ---------------'
do $$ declare refusal text; begin
  begin
    perform public.place_order(
      jsonb_build_array(jsonb_build_object(
        'product_id', (select id from picked_product), 'color', 'Neon Pink', 'size', 'M', 'quantity', 1)),
      null, null, null, 'Asha', '9876543210');
  exception when others then refusal := sqlerrm; end;
  perform expect_refusal(refusal, array['has only 0 left']);
end $$;

\echo ''
\echo '10. Somebody else''s address_id is refused ---------------------------'
-- addresses_assign_owner() overwrites user_id with auth.uid(), so a customer
-- cannot forge an address owned by another account. The trigger is lifted here
-- only so the RPC's own p_address_id check can be tested against a genuinely
-- foreign row, which is defence in depth rather than the only line of defence.
insert into auth.users (id, email, email_confirmed_at)
values ('22222222-2222-2222-2222-222222222222', 'other@example.com', now())
on conflict (id) do nothing;
update public.profiles
set full_name = 'Ravi', status = 'active', is_active = true, email_verified_at = now()
where id = '22222222-2222-2222-2222-222222222222';

alter table public.addresses disable trigger trg_addresses_assign_owner;
insert into public.addresses (user_id, label, full_name, phone, line1, city, state, pincode)
values ('22222222-2222-2222-2222-222222222222', 'Home', 'Ravi', '9000000000',
        '9 Park St', 'Mumbai', 'MH', '400001');
alter table public.addresses enable trigger trg_addresses_assign_owner;

do $$ declare foreign_address uuid; refusal text; begin
  select id into foreign_address from public.addresses
   where user_id = '22222222-2222-2222-2222-222222222222' limit 1;
  begin
    perform public.place_order(
      jsonb_build_array(jsonb_build_object(
        'product_id', (select id from picked_product), 'color', (select color from picked_product), 'size', (select size from picked_product), 'quantity', 1)),
      '{"full_name":"Asha","phone":"9876543210","line1":"12 MG Road","city":"Pune","state":"MH","pincode":"411001"}'::jsonb,
      null, foreign_address, 'Asha', '9876543210');
  exception when others then refusal := sqlerrm; end;
  perform expect_refusal(refusal, array['does not belong to you']);
end $$;

\echo ''
\echo '11. A staff account cannot place a customer order --------------------'
insert into auth.users (id, email, email_confirmed_at)
values ('33333333-3333-3333-3333-333333333333', 'helper@example.com', now())
on conflict (id) do nothing;
-- Same reasoning as above: the signup trigger always creates 'customer', so the
-- guard is lifted for one statement to manufacture a staff row.
alter table public.profiles disable trigger trg_profiles_role_change;
update public.profiles
set role = 'staff', status = 'active', is_active = true, email_verified_at = now()
where id = '33333333-3333-3333-3333-333333333333';
alter table public.profiles enable trigger trg_profiles_role_change;

do $$ declare refusal text; begin
  begin
    perform set_config('request.jwt.claim.sub', '33333333-3333-3333-3333-333333333333', true);
    perform public.place_order(
      jsonb_build_array(jsonb_build_object(
        'product_id', (select id from picked_product), 'color', (select color from picked_product), 'size', (select size from picked_product), 'quantity', 1)),
      null, null, null, 'Helper', '9000000000');
  exception when others then refusal := sqlerrm; end;
  perform expect_refusal(refusal, array['only a verified, active customer']);
end $$;
reset request.jwt.claim.sub;

\echo ''
\echo '12. A customer cannot write to orders or order_items directly --------'
-- The regression that matters most. Before 017 `authenticated` held a blanket
-- INSERT on both tables, so a customer could skip the function entirely, post
-- their own unit_price, and leave a free order in the staff dispatch log for
-- someone to fulfil over WhatsApp. Reproduced before the fix as 40 hoodies at
-- a total of 0.00. `place_order` is now the only writer, so the privilege has
-- to simply not exist.
--
-- These run inside a transaction as `authenticated` rather than as the
-- migration role. A table owner bypasses GRANT entirely, so checking privileges
-- as postgres would pass whatever the grants actually say -- which is how this
-- very hole stayed invisible for as long as it did.
begin;
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', true);
grant execute on function public.expect_refusal(text, text[]) to authenticated;
set local role authenticated;

do $$ declare refusal text; begin
  begin
    insert into public.orders (reference, status, item_count, subtotal, total, customer_name)
    values ('KV-DIRECT-INSERT', 'placed', 40, 0, 0, 'Attacker');
  exception when others then refusal := sqlerrm; end;
  perform expect_refusal(refusal, array['permission denied', 'row-level security']);
end $$;

do $$ declare my_order uuid; refusal text; begin
  select id into my_order from public.orders order by created_at desc limit 1;
  begin
    insert into public.order_items (order_id, name, unit_price, quantity, line_total)
    values (my_order, 'Shadow Oversized Hoodie', 0, 40, 0);
  exception when others then refusal := sqlerrm; end;
  perform expect_refusal(refusal, array['permission denied', 'row-level security']);
end $$;

\echo ''
\echo '13. A customer still cannot rewrite a stored order ------------------'
-- Re-granting a table privilege is a one-line mistake; these three make it
-- visible the moment it happens. Status belongs to set_order_status alone, and
-- a stored total must never be restated by the person it belongs to.
do $$ declare my_order uuid; refusal text; begin
  select id into my_order from public.orders order by created_at desc limit 1;
  begin
    update public.orders set status = 'delivered' where id = my_order;
  exception when others then refusal := sqlerrm; end;
  perform expect_refusal(refusal, array['permission denied', 'row-level security']);
end $$;

do $$ declare my_order uuid; refusal text; begin
  select id into my_order from public.orders order by created_at desc limit 1;
  begin
    delete from public.orders where id = my_order;
  exception when others then refusal := sqlerrm; end;
  perform expect_refusal(refusal, array['permission denied', 'row-level security']);
end $$;

do $$ declare my_order uuid; refusal text; begin
  select id into my_order from public.orders order by created_at desc limit 1;
  begin
    update public.orders set total = 1 where id = my_order;
  exception when others then refusal := sqlerrm; end;
  perform expect_refusal(refusal, array['permission denied', 'row-level security']);
end $$;

reset role;
commit;
revoke execute on function public.expect_refusal(text, text[]) from authenticated;

\echo ''
\echo '14. No orphan rows survived any refusal ------------------------------'
-- The real assertion. A rejected payload that left a header row behind would
-- mean the transaction did not roll back, which is the exact failure this
-- function exists to prevent. Compared against the baseline rather than an
-- absolute count, so the file can be re-run against the same database.
select (select count(*) from public.orders) - (select orders from baseline) as new_orders,
       (select count(*) from public.order_items) - (select items from baseline) as new_items;

do $$
declare new_orders integer;
        new_items  integer;
begin
  select (select count(*) from public.orders) - (select orders from baseline) into new_orders;
  select (select count(*) from public.order_items) - (select items from baseline) into new_items;
  if new_orders <> 0 or new_items <> 0 then
    raise exception 'FAIL: a refused order left % header row(s) and % line(s) behind', new_orders, new_items;
  else
    raise notice 'ok, every refusal rolled back cleanly';
  end if;
end
$$;

-- The helper lives in `public` only because the EXCEPTION handler restriction
-- above rules out calling it from inside one. Left behind on a scratch
-- database it would be misleading, so it goes.
drop function if exists public.expect_refusal(text, text[]);
