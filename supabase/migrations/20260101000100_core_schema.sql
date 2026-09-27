-- ===========================================================================
-- Kaal Vastr — 001 core schema
-- Customer-facing storefront catalogue + client/admin product management.
--
-- Access model (enforced in 002_rls_policies.sql):
--   products           read: public (active only) | write: admin
--   business_settings  read: public               | write: admin
--   profiles           read: self + admin         | write: self (non-role) / admin
--   product_images     read: public               | write: admin
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- Shared trigger helper: keep updated_at honest without trusting the client.
-- ---------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- profiles — one row per auth user. Role is assigned by the database only;
-- a client can never self-assign `admin` through signup metadata.
-- ---------------------------------------------------------------------------
create table if not exists public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  email       text        not null,
  full_name   text        not null default '',
  role        text        not null default 'customer'
                          check (role in ('customer', 'staff', 'admin')),
  is_active   boolean     not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  constraint profiles_email_present check (length(btrim(email)) > 0)
);

comment on table public.profiles is
  'Role directory, one row per auth.users entry. Created by handle_new_user().';
comment on column public.profiles.role is
  'customer = public shopper, staff = future catalogue helpdesk, admin = full product management.';

create unique index if not exists profiles_email_key on public.profiles (lower(email));
create index if not exists profiles_role_idx on public.profiles (role) where is_active;

drop trigger if exists trg_profiles_updated_at on public.profiles;
create trigger trg_profiles_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Auth accounts created by an admin (invites, phone sign-in) may have no email
  -- address at all, so fall back to a stable placeholder that keeps the
  -- profiles.email_present check satisfied.
  insert into public.profiles (id, email, full_name, role)
  values (
    new.id,
    coalesce(new.email, 'phone-' || new.id::text),
    coalesce(new.raw_user_meta_data ->> 'full_name', ''),
    'customer'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- products — the storefront catalogue.
-- `variant_stock` is a jsonb map keyed "Colour|Size" -> whole units.
-- The flat `stock` column is always derived from it when a map is present,
-- so grid badges and admin tables never drift out of sync.
-- ---------------------------------------------------------------------------
create table if not exists public.products (
  id               uuid primary key default gen_random_uuid(),
  name             text          not null,
  slug             text          not null,
  category         text          not null,
  brand            text          not null default 'Kaal Vastr',
  sku              text          not null,
  description      text,
  selling_price    numeric(10,2) not null check (selling_price >= 0),
  compare_at_price numeric(10,2) check (compare_at_price is null or compare_at_price >= 0),
  sizes            text[]        not null default array['S','M','L','XL']::text[],
  colors           text[]        not null default '{}'::text[],
  variant_stock    jsonb,
  stock            integer       not null default 0 check (stock >= 0),
  image_url        text,
  images           text[]        not null default '{}'::text[],
  is_featured      boolean       not null default false,
  is_available     boolean       not null default true,
  is_archived      boolean       not null default false,
  created_at       timestamptz   not null default now(),
  updated_at       timestamptz   not null default now(),

  constraint products_name_present  check (length(btrim(name)) > 0),
  constraint products_sku_present   check (length(btrim(sku)) > 0),
  constraint products_slug_present  check (length(btrim(slug)) > 0),
  constraint products_category_present check (length(btrim(category)) > 0)
);

comment on table public.products is
  'Product catalogue. Public may read active rows; only admins may write.';
comment on column public.products.slug is
  'URL-safe handle used by /product/:slug. Derived from name by the admin form.';
comment on column public.products.compare_at_price is
  'Optional "was" price. Must be greater than selling_price when set.';
comment on column public.products.variant_stock is
  'Per colour+size units keyed "Color|Size", e.g. {"Obsidian Black|S":4}. '
  'NULL or {} means the product uses the flat stock column only. A colour+size '
  'missing from the map is treated as 0 (out of stock).';
comment on column public.products.stock is
  'Total sellable units. Derived from variant_stock by trigger; never trust a '
  'client-supplied value for this column.';
comment on column public.products.is_archived is
  'true keeps the record but removes it from the storefront and catalogue.';

create unique index if not exists products_sku_key  on public.products (sku);
create unique index if not exists products_slug_key on public.products (slug);

-- Catalogue browsing / filtering: active rows, by category then price.
create index if not exists products_browse_idx
  on public.products (category, selling_price)
  where is_archived = false;

create index if not exists products_archived_idx on public.products (is_archived);
create index if not exists products_featured_idx
  on public.products (is_featured, created_at desc)
  where is_archived = false and is_available = true;

-- Free-text catalogue search. PostgREST `ilike '%term%'` cannot use a btree, so
-- the trigram index is what keeps the shop search fast.
create extension if not exists pg_trgm;

create index if not exists products_name_lower_idx on public.products (lower(name));
create index if not exists products_name_trgm_idx  on public.products using gin (name gin_trgm_ops);
create index if not exists products_description_trgm_idx
  on public.products using gin (description gin_trgm_ops);

drop trigger if exists trg_products_updated_at on public.products;
create trigger trg_products_updated_at
  before update on public.products
  for each row execute function public.set_updated_at();

-- Reject malformed variant payloads before they reach the table.
--
-- The loop target must mirror `jsonb_each`'s output columns (text, jsonb).
-- Iterating into a single jsonb variable instead would coerce the whole record
-- to jsonb, which is never valid JSON and fails with
-- `invalid input syntax for type json` on the first key.
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

drop trigger if exists trg_products_variant_stock_valid on public.products;
create trigger trg_products_variant_stock_valid
  before insert or update of variant_stock on public.products
  for each row execute function public.products_variant_stock_is_valid();

-- Keep the flat total and availability in step with the variants so list views
-- and admin tables stay correct without extra joins.
create or replace function public.products_sync_total_stock()
returns trigger
language plpgsql
as $$
declare
  total integer;
begin
  if new.variant_stock is not null
     and jsonb_typeof(new.variant_stock) = 'object'
     and new.variant_stock <> '{}'::jsonb then

    select coalesce(sum((value #>> '{}')::numeric), 0)::integer
      into total
      from jsonb_each(new.variant_stock);

    new.stock := total;
  else
    new.stock := greatest(coalesce(new.stock, 0), 0);
  end if;

  if new.stock <= 0 then
    new.is_available := false;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_products_sync_total_stock on public.products;
create trigger trg_products_sync_total_stock
  before insert or update on public.products
  for each row execute function public.products_sync_total_stock();

-- A "compare at" price below the selling price is a data-entry error.
create or replace function public.products_compare_price_is_valid()
returns trigger
language plpgsql
as $$
begin
  if new.compare_at_price is not null and new.compare_at_price <= new.selling_price then
    raise exception 'compare_at_price (%) must be greater than selling_price (%)',
      new.compare_at_price, new.selling_price;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_products_compare_price_valid on public.products;
create trigger trg_products_compare_price_valid
  before insert or update on public.products
  for each row execute function public.products_compare_price_is_valid();

-- ---------------------------------------------------------------------------
-- business_settings — single store-wide configuration row (id = 'biz-001').
-- Everything customer-facing about the store lives here, never in components.
-- ---------------------------------------------------------------------------
create table if not exists public.business_settings (
  id              text primary key default 'biz-001',
  business_name   text        not null default 'Kaal Vastr',
  tagline         text,
  description     text,
  whatsapp_number text        not null default '',
  mobile_number   text,
  email           text,
  address         text,
  city            text,
  state           text,
  pincode         text,
  store_timings   text,
  gst_number      text,
  upi_id          text,
  instagram_url   text,
  facebook_url    text,
  logo_url        text,
  hero_image_url  text,
  updated_at      timestamptz not null default now(),

  -- Guarantees exactly one configuration row.
  constraint business_settings_singleton check (id = 'biz-001')
);

comment on table public.business_settings is
  'Store-wide configuration. Exactly one row, id = ''biz-001''.';
comment on column public.business_settings.whatsapp_number is
  'WhatsApp order destination in international digits-only form, e.g. 919876543210.';

drop trigger if exists trg_business_settings_updated_at on public.business_settings;
create trigger trg_business_settings_updated_at
  before update on public.business_settings
  for each row execute function public.set_updated_at();
