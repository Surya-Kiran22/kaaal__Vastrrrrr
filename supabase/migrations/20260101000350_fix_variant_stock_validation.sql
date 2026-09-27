-- ===========================================================================
-- Kaal Vastr — 00350 fix variant_stock validation trigger
--
-- Ordering note: this file must sort *before* 20260101000400_seed_demo_data,
-- because the demo catalogue inserts rows that exercise this trigger. Projects
-- that already applied 001-003 get the corrected function here; fresh installs
-- get the same corrected body from 001 directly, and this migration is a no-op
-- re-create.
--
-- The bug: the original loop was
--     for entry in select * from jsonb_each(new.variant_stock) loop
--     ... entry.key ... entry.value ...
-- `jsonb_each` returns two columns (key text, value jsonb), so PL/pgSQL coerced
-- the entire record into the single jsonb variable `entry`. The record's text
-- form is not valid JSON, so *every* insert with a variant map failed with
--     invalid input syntax for type json ... Token "<first key>" is invalid
-- Iterating into matching scalar variables is the correct form.
-- ===========================================================================

create or replace function public.products_variant_stock_is_valid()
returns trigger
language plpgsql
as $$
declare
  entry_key   text;
  entry_value jsonb;
  entry_num   numeric;
begin
  if new.variant_stock is null or new.variant_stock = '{}'::jsonb then
    return new;
  end if;

  if jsonb_typeof(new.variant_stock) <> 'object' then
    raise exception 'variant_stock must be a JSON object keyed "Color|Size"';
  end if;

  for entry_key, entry_value in
    select key, value from jsonb_each(new.variant_stock)
  loop
    if entry_key !~ '\|' then
      raise exception 'variant_stock key "%" must look like "Color|Size"', entry_key;
    end if;

    if jsonb_typeof(entry_value) <> 'number' then
      raise exception 'variant_stock["%"] must be a non-negative whole number', entry_key;
    end if;

    entry_num := (entry_value #>> '{}')::numeric;
    if entry_num < 0 or entry_num <> trunc(entry_num) then
      raise exception 'variant_stock["%"] must be a non-negative whole number', entry_key;
    end if;
  end loop;

  return new;
end;
$$;
