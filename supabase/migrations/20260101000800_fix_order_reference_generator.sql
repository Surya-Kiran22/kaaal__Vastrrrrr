-- ===========================================================================
-- Kaal Vastr — 008 fix the order reference generator
--
-- 006 built the human-facing order reference out of gen_random_bytes(), which
-- lives in the pgcrypto extension. That extension is not enabled on this
-- project, so the function existed but raised 42883
-- "function gen_random_bytes(integer) does not exist" the first time an order
-- was placed. The generator is on the critical path for checkout.
--
-- gen_random_uuid() is built into PostgreSQL 13+ (it already backs every id
-- column in this schema), so the suffix is taken from a uuid instead of pulling
-- in an extension just to produce six hex characters.
-- ===========================================================================

create or replace function public.new_order_reference()
returns text
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  candidate text;
  attempts  int := 0;
begin
  -- The date prefix plus six hex characters is ~16.7M values per day, so a
  -- collision is vanishingly rare; the retry loop only guards against a
  -- deliberately chosen reference.
  while attempts < 5 loop
    candidate := 'KV-'
      || to_char(now() at time zone 'Asia/Kolkata', 'YYMMDD')
      || '-'
      || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6));

    exit when not exists (select 1 from public.orders where reference = candidate);
    attempts := attempts + 1;
  end loop;

  return candidate;
end;
$$;

revoke all on function public.new_order_reference() from public, anon;
grant execute on function public.new_order_reference() to authenticated;

-- PostgREST resolves /rest/v1/rpc/* from its own cached catalogue. Migrations
-- pushed over the pooler do not always invalidate it, so ask it to reload.
-- Without this the endpoint 404s with 42883 even though the function exists.
notify pgrst, 'reload schema';
