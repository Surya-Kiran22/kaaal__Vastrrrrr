-- ===========================================================================
-- Kaal Vastr — combined installer
--
-- GENERATED FILE — do not edit by hand. Run `npm run db:bundle` instead.
--
-- Every migration in supabase/migrations concatenated in filename order
-- (17 files). Safe to run more than
-- once: statements are "if not exists" / "drop ... if exists" and the demo
-- catalogue upserts on the unique SKU.
--
-- Use this ONLY when `supabase db push` is unavailable (for example when your
-- account lacks Management API access to the project).
--
-- How to run:
--   Supabase Dashboard -> your project -> SQL Editor -> New query
--   paste this whole file -> Run
--
-- The Supabase SQL editor runs the script in a single transaction, so either
-- the whole schema lands or nothing does.
--
-- After running it, still create the first admin:
--   npm run admin:bootstrap -- owner@example.com
-- ===========================================================================

-- ###########################################################################
-- FILE: supabase/migrations/20260101000100_core_schema.sql
-- ###########################################################################
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

-- ###########################################################################
-- FILE: supabase/migrations/20260101000200_rls_policies.sql
-- ###########################################################################
-- ===========================================================================
-- Kaal Vastr — 002 authorization helpers + row level security
--
-- The store is public. Everything that mutates a product, an image or the
-- business configuration requires an authenticated `admin` profile row.
-- The helpers are SECURITY DEFINER with a pinned search_path so RLS on
-- `profiles` can never recurse back into itself.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- Authorization helpers. They read the caller's JWT (auth.uid()), never a
-- value supplied by the client.
-- ---------------------------------------------------------------------------
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin' and is_active
  );
$$;

create or replace function public.is_staff_or_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role in ('admin', 'staff') and is_active
  );
$$;

-- The two helpers below read the *caller's own* profile. They are SECURITY
-- DEFINER because a plain sub-select on `profiles` inside a `profiles` policy
-- re-enters RLS on the same relation and Postgres aborts the statement with
-- "infinite recursion detected in policy".
create or replace function public.my_profile_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select role from public.profiles where id = auth.uid();
$$;

create or replace function public.my_profile_is_active()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select is_active from public.profiles where id = auth.uid();
$$;

-- Supabase's default privileges grant EXECUTE on new functions to anon,
-- authenticated and service_role, so revoking from PUBLIC alone is not enough —
-- anon must be revoked by name or the helper stays callable by the public.
revoke all on function public.my_profile_role() from public, anon;
revoke all on function public.my_profile_is_active() from public, anon;
grant execute on function public.my_profile_role() to authenticated;
grant execute on function public.my_profile_is_active() to authenticated;

-- ---------------------------------------------------------------------------
-- products
-- ---------------------------------------------------------------------------
alter table public.products enable row level security;

-- Public shoppers may only ever see active, available, non-archived rows.
drop policy if exists "products_public_read" on public.products;
create policy "products_public_read"
  on public.products for select
  using (is_archived = false and is_available = true);

-- Admins additionally see archived / sold-out rows so they can restore them.
drop policy if exists "products_admin_read_all" on public.products;
create policy "products_admin_read_all"
  on public.products for select
  using (public.is_admin());

drop policy if exists "products_admin_insert" on public.products;
create policy "products_admin_insert"
  on public.products for insert
  with check (public.is_admin());

drop policy if exists "products_admin_update" on public.products;
create policy "products_admin_update"
  on public.products for update
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists "products_admin_delete" on public.products;
create policy "products_admin_delete"
  on public.products for delete
  using (public.is_admin());

-- ---------------------------------------------------------------------------
-- business_settings
-- ---------------------------------------------------------------------------
alter table public.business_settings enable row level security;

drop policy if exists "business_settings_public_read" on public.business_settings;
create policy "business_settings_public_read"
  on public.business_settings for select
  using (true);

drop policy if exists "business_settings_admin_insert" on public.business_settings;
create policy "business_settings_admin_insert"
  on public.business_settings for insert
  with check (public.is_admin());

drop policy if exists "business_settings_admin_update" on public.business_settings;
create policy "business_settings_admin_update"
  on public.business_settings for update
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists "business_settings_admin_delete" on public.business_settings;
create policy "business_settings_admin_delete"
  on public.business_settings for delete
  using (public.is_admin());

-- ---------------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------------
alter table public.profiles enable row level security;

drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own"
  on public.profiles for select
  using (auth.uid() = id);

-- Admins get the full directory so they can audit who holds access.
drop policy if exists "profiles_admin_read_all" on public.profiles;
create policy "profiles_admin_read_all"
  on public.profiles for select
  using (public.is_admin());

-- Self-service update, but a user can never escalate their own role, and can
-- never re-activate a disabled account.
drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own"
  on public.profiles for update
  using (auth.uid() = id)
  with check (
    auth.uid() = id
    and role = public.my_profile_role()
    and is_active = public.my_profile_is_active()
  );

drop policy if exists "profiles_admin_update" on public.profiles;
create policy "profiles_admin_update"
  on public.profiles for update
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists "profiles_admin_insert" on public.profiles;
create policy "profiles_admin_insert"
  on public.profiles for insert
  with check (public.is_admin());

drop policy if exists "profiles_admin_delete" on public.profiles;
create policy "profiles_admin_delete"
  on public.profiles for delete
  using (public.is_admin());

-- ###########################################################################
-- FILE: supabase/migrations/20260101000300_storage.sql
-- ###########################################################################
-- ===========================================================================
-- Kaal Vastr — 003 product image storage
--
-- A single public bucket, `product-images`. Public SELECT so the storefront can
-- hotlink images directly; INSERT/UPDATE/DELETE restricted to admins. Uploads
-- land at `products/<random-folder>/<timestamp>.<ext>` (see
-- src/hooks/useAdminMutations.ts): the random folder is a garbage-collection
-- boundary and the timestamped name means no user-controlled text ever reaches
-- a storage key.
-- ===========================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'product-images',
  'product-images',
  true,
  5242880, -- 5 MB
  array['image/jpeg', 'image/png', 'image/webp', 'image/avif']
)
on conflict (id) do update
  set public             = excluded.public,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "product_images_public_read" on storage.objects;
create policy "product_images_public_read"
  on storage.objects for select
  using (bucket_id = 'product-images');

drop policy if exists "product_images_admin_insert" on storage.objects;
create policy "product_images_admin_insert"
  on storage.objects for insert
  with check (bucket_id = 'product-images' and public.is_admin());

drop policy if exists "product_images_admin_update" on storage.objects;
create policy "product_images_admin_update"
  on storage.objects for update
  using (bucket_id = 'product-images' and public.is_admin())
  with check (bucket_id = 'product-images' and public.is_admin());

drop policy if exists "product_images_admin_delete" on storage.objects;
create policy "product_images_admin_delete"
  on storage.objects for delete
  using (bucket_id = 'product-images' and public.is_admin());

-- ###########################################################################
-- FILE: supabase/migrations/20260101000350_fix_variant_stock_validation.sql
-- ###########################################################################
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

-- ###########################################################################
-- FILE: supabase/migrations/20260101000400_seed_demo_data.sql
-- ###########################################################################
-- ===========================================================================
-- Kaal Vastr — 004 demo catalogue + business settings
--
-- Idempotent: re-running refreshes the store profile and upserts products by
-- SKU. Replace the business contact block with client-approved final values.
-- The `stock` column is intentionally omitted because the trigger derives it
-- from `variant_stock`.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- Store configuration. Customers never see these values hard-coded in the UI;
-- every component reads them from this row.
-- ---------------------------------------------------------------------------
insert into public.business_settings
  (id, business_name, tagline, description, whatsapp_number, mobile_number, email,
   address, city, state, pincode, store_timings, gst_number, upi_id,
   instagram_url, facebook_url, logo_url, hero_image_url)
values
  ('biz-001',
   'Kaal Vastr',
   'Dark by design.',
   'Kaal Vastr is a minimalist dark-grey and silver clothing label. We design heavyweight staples, sharp silhouettes and monochrome essentials for people who prefer less, but better.',
   '919876543210',
   '+91 98765 43210',
   'contact@kaalvastr.in',
   '104, Obsidian Avenue, Khar West',
   'Mumbai',
   'Maharashtra',
   '400052',
   'Mon - Sat: 11:00 AM - 9:00 PM | Sun: 12:00 PM - 7:00 PM',
   '27ABCDE1234F1Z5',
   'kaalvastr@upi',
   'https://instagram.com/kaalvastr',
   'https://facebook.com/kaalvastr',
   '',
   'https://images.unsplash.com/photo-1523381210434-271e8be1f52b?auto=format&fit=crop&w=1920&q=80')
on conflict (id) do update set
  business_name   = excluded.business_name,
  tagline         = excluded.tagline,
  description     = excluded.description,
  whatsapp_number = excluded.whatsapp_number,
  mobile_number   = excluded.mobile_number,
  email           = excluded.email,
  address         = excluded.address,
  city            = excluded.city,
  state           = excluded.state,
  pincode         = excluded.pincode,
  store_timings   = excluded.store_timings,
  gst_number      = excluded.gst_number,
  upi_id          = excluded.upi_id,
  instagram_url   = excluded.instagram_url,
  facebook_url    = excluded.facebook_url,
  hero_image_url  = excluded.hero_image_url,
  updated_at      = now();

-- ---------------------------------------------------------------------------
-- Demo catalogue.
-- ---------------------------------------------------------------------------
insert into public.products
  (name, slug, category, brand, sku, description, selling_price, compare_at_price,
   sizes, colors, variant_stock, image_url, images, is_featured, is_available)
values
  -- 1 ---------------------------------------------------------------------
  ('Shadow Oversized Hoodie', 'shadow-oversized-hoodie', 'Hoodies', 'Kaal Vastr', 'KV-HD-001',
   'Heavyweight 450 GSM French-terry cotton hoodie in deep obsidian black. Dropped shoulders, double-stitched seams and tonal silver branding keep the silhouette clean and boxy.',
   4499, 5999,
   array['S','M','L','XL','XXL']::text[],
   array['Obsidian Black','Charcoal Grey']::text[],
   '{"Obsidian Black|S":4,"Obsidian Black|M":6,"Obsidian Black|L":5,"Obsidian Black|XL":3,"Obsidian Black|XXL":2,"Charcoal Grey|S":3,"Charcoal Grey|M":0,"Charcoal Grey|L":2,"Charcoal Grey|XL":2,"Charcoal Grey|XXL":0}'::jsonb,
   'https://images.unsplash.com/photo-1556905055-8f358a7a47b2?auto=format&fit=crop&w=1200&q=80',
   array[
     'https://images.unsplash.com/photo-1556905055-8f358a7a47b2?auto=format&fit=crop&w=1200&q=80',
     'https://images.unsplash.com/photo-1509967419530-da38b4704bc6?auto=format&fit=crop&w=1200&q=80',
     'https://images.unsplash.com/photo-1620799140408-edc6dcb6d633?auto=format&fit=crop&w=1200&q=80'
   ]::text[],
   true, true),

  -- 2 ---------------------------------------------------------------------
  ('Monolith Heavyweight Tee', 'monolith-heavyweight-tee', 'T-Shirts', 'Kaal Vastr', 'KV-TS-002',
   '240 GSM combed cotton tee with a structured, non-transparent drape. Reinforced collar, boxy body and a small woven KV tab at the hem.',
   1299, 1799,
   array['S','M','L','XL','XXL']::text[],
   array['Obsidian Black','Off White','Slate Grey']::text[],
   '{"Obsidian Black|S":12,"Obsidian Black|M":18,"Obsidian Black|L":15,"Obsidian Black|XL":9,"Obsidian Black|XXL":4,"Off White|S":8,"Off White|M":10,"Off White|L":6,"Off White|XL":3,"Off White|XXL":0,"Slate Grey|S":0,"Slate Grey|M":0,"Slate Grey|L":4,"Slate Grey|XL":2,"Slate Grey|XXL":0}'::jsonb,
   'https://images.unsplash.com/photo-1521572163474-6864f9cf17ab?auto=format&fit=crop&w=1200&q=80',
   array[
     'https://images.unsplash.com/photo-1521572163474-6864f9cf17ab?auto=format&fit=crop&w=1200&q=80',
     'https://images.unsplash.com/photo-1583743814966-8936f37f4678?auto=format&fit=crop&w=1200&q=80'
   ]::text[],
   true, true),

  -- 3 ---------------------------------------------------------------------
  ('Noir Bomber Jacket', 'noir-bomber-jacket', 'Jackets', 'Kaal Vastr', 'KV-JK-003',
   'Matte-black bomber in water-resistant twill with a satin lining, ribbed cuffs and a silver-tone zip pull. Cut relaxed through the body.',
   7499, 8999,
   array['S','M','L','XL']::text[],
   array['Obsidian Black','Gunmetal']::text[],
   '{"Obsidian Black|S":3,"Obsidian Black|M":5,"Obsidian Black|L":4,"Obsidian Black|XL":2,"Gunmetal|S":2,"Gunmetal|M":0,"Gunmetal|L":1,"Gunmetal|XL":0}'::jsonb,
   'https://images.unsplash.com/photo-1551028719-00167b16eac5?auto=format&fit=crop&w=1200&q=80',
   array[
     'https://images.unsplash.com/photo-1551028719-00167b16eac5?auto=format&fit=crop&w=1200&q=80',
     'https://images.unsplash.com/photo-1591047139829-d91aecb6caea?auto=format&fit=crop&w=1200&q=80'
   ]::text[],
   true, true),

  -- 4 ---------------------------------------------------------------------
  ('Onyx Cargo Trousers', 'onyx-cargo-trousers', 'Trousers', 'Kaal Vastr', 'KV-TR-004',
   'Utility cargo trousers in washed cotton-nylon ripstop. Six pockets, an adjustable hem drawcord and a straight tapered leg.',
   3299, null,
   array['28','30','32','34','36']::text[],
   array['Obsidian Black','Stone Grey']::text[],
   '{"Obsidian Black|28":5,"Obsidian Black|30":7,"Obsidian Black|32":9,"Obsidian Black|34":6,"Obsidian Black|36":2,"Stone Grey|28":2,"Stone Grey|30":3,"Stone Grey|32":4,"Stone Grey|34":0,"Stone Grey|36":0}'::jsonb,
   'https://images.unsplash.com/photo-1624378439575-d8705ad7ae80?auto=format&fit=crop&w=1200&q=80',
   array[
     'https://images.unsplash.com/photo-1624378439575-d8705ad7ae80?auto=format&fit=crop&w=1200&q=80',
     'https://images.unsplash.com/photo-1517445312882-bc9910d016b7?auto=format&fit=crop&w=1200&q=80'
   ]::text[],
   false, true),

  -- 5 ---------------------------------------------------------------------
  ('Carbon Overshirt', 'carbon-overshirt', 'Shirts', 'Kaal Vastr', 'KV-SH-005',
   'Structured overshirt in brushed cotton flannel, cut to layer over a tee. Tonal buttons, chest pocket and a straight hem.',
   3899, 4599,
   array['S','M','L','XL']::text[],
   array['Carbon Black','Graphite']::text[],
   '{"Carbon Black|S":4,"Carbon Black|M":6,"Carbon Black|L":5,"Carbon Black|XL":3,"Graphite|S":3,"Graphite|M":3,"Graphite|L":0,"Graphite|XL":0}'::jsonb,
   'https://images.unsplash.com/photo-1602810318383-e386cc2a3ccf?auto=format&fit=crop&w=1200&q=80',
   array[
     'https://images.unsplash.com/photo-1602810318383-e386cc2a3ccf?auto=format&fit=crop&w=1200&q=80',
     'https://images.unsplash.com/photo-1596755094514-f87e34085b2c?auto=format&fit=crop&w=1200&q=80'
   ]::text[],
   true, true),

  -- 6 ---------------------------------------------------------------------
  ('Graphite Zip Hoodie', 'graphite-zip-hoodie', 'Hoodies', 'Kaal Vastr', 'KV-HD-006',
   'Mid-weight 320 GSM loopback zip hoodie with a matte metal zip and a double-lined hood. Slim-merino-blend cuffs for shape retention.',
   3699, null,
   array['S','M','L','XL','XXL']::text[],
   array['Graphite Grey','Obsidian Black']::text[],
   '{"Graphite Grey|S":6,"Graphite Grey|M":8,"Graphite Grey|L":7,"Graphite Grey|XL":4,"Graphite Grey|XXL":2,"Obsidian Black|S":5,"Obsidian Black|M":5,"Obsidian Black|L":0,"Obsidian Black|XL":0,"Obsidian Black|XXL":0}'::jsonb,
   'https://images.unsplash.com/photo-1578681994506-b8f463449011?auto=format&fit=crop&w=1200&q=80',
   array[
     'https://images.unsplash.com/photo-1578681994506-b8f463449011?auto=format&fit=crop&w=1200&q=80',
     'https://images.unsplash.com/photo-1614495039153-42ea96c8f6a9?auto=format&fit=crop&w=1200&q=80'
   ]::text[],
   false, true),

  -- 7 ---------------------------------------------------------------------
  ('Meridian Denim Jacket', 'meridian-denim-jacket', 'Jackets', 'Kaal Vastr', 'KV-JK-007',
   'Rigid 12 oz indigo-black denim trucker with contrast silver stitching, a chest flap pocket and a slightly cropped hem.',
   8299, 9999,
   array['S','M','L','XL']::text[],
   array['Midnight Indigo','Washed Black']::text[],
   '{"Midnight Indigo|S":2,"Midnight Indigo|M":4,"Midnight Indigo|L":3,"Midnight Indigo|XL":2,"Washed Black|S":1,"Washed Black|M":2,"Washed Black|L":0,"Washed Black|XL":0}'::jsonb,
   'https://images.unsplash.com/photo-1543076447-215ad9ba6923?auto=format&fit=crop&w=1200&q=80',
   array[
     'https://images.unsplash.com/photo-1543076447-215ad9ba6923?auto=format&fit=crop&w=1200&q=80',
     'https://images.unsplash.com/photo-1544441893-675973e31985?auto=format&fit=crop&w=1200&q=80'
   ]::text[],
   true, true),

  -- 8 ---------------------------------------------------------------------
  ('Ember Knit Sweater', 'ember-knit-sweater', 'Sweaters', 'Kaal Vastr', 'KV-SW-008',
   'Merino-blend crewneck with a subtle charcoal marl. Warm, breathable and cut close to the body for easy layering.',
   4299, null,
   array['S','M','L','XL']::text[],
   array['Ember Charcoal','Ash Grey']::text[],
   '{"Ember Charcoal|S":4,"Ember Charcoal|M":6,"Ember Charcoal|L":5,"Ember Charcoal|XL":3,"Ash Grey|S":3,"Ash Grey|M":3,"Ash Grey|L":2,"Ash Grey|XL":0}'::jsonb,
   'https://images.unsplash.com/photo-1611312449412-6cefac5dc3e4?auto=format&fit=crop&w=1200&q=80',
   array[
     'https://images.unsplash.com/photo-1611312449412-6cefac5dc3e4?auto=format&fit=crop&w=1200&q=80',
     'https://images.unsplash.com/photo-1576566588028-4147f3842f27?auto=format&fit=crop&w=1200&q=80'
   ]::text[],
   false, true),

  -- 9 ---------------------------------------------------------------------
  ('Void Slim Jeans', 'void-slim-jeans', 'Trousers', 'Kaal Vastr', 'KV-TR-009',
   'Jet-black slim jeans in comfort-stretch denim with a clean hem finish and a mid rise. Built to hold shape all day.',
   2999, 3499,
   array['28','30','32','34','36','38']::text[],
   array['Void Black','Dark Indigo']::text[],
   '{"Void Black|28":6,"Void Black|30":9,"Void Black|32":11,"Void Black|34":7,"Void Black|36":4,"Void Black|38":0,"Dark Indigo|28":0,"Dark Indigo|30":4,"Dark Indigo|32":5,"Dark Indigo|34":3,"Dark Indigo|36":0,"Dark Indigo|38":0}'::jsonb,
   'https://images.unsplash.com/photo-1541099649105-f69ad21f3246?auto=format&fit=crop&w=1200&q=80',
   array[
     'https://images.unsplash.com/photo-1541099649105-f69ad21f3246?auto=format&fit=crop&w=1200&q=80',
     'https://images.unsplash.com/photo-1475178626620-a4d074967452?auto=format&fit=crop&w=1200&q=80'
   ]::text[],
   false, true),

  -- 10 --------------------------------------------------------------------
  ('Obsidian Tee — Boxy', 'obsidian-tee-boxy', 'T-Shirts', 'Kaal Vastr', 'KV-TS-010',
   'The everyday tee, cut wide and cropped just below the belt. 200 GSM ringspun cotton with a ribbed neckline.',
   1099, 1499,
   array['S','M','L','XL']::text[],
   array['Obsidian Black','Bone White']::text[],
   '{"Obsidian Black|S":14,"Obsidian Black|M":20,"Obsidian Black|L":18,"Obsidian Black|XL":10,"Bone White|S":10,"Bone White|M":12,"Bone White|L":8,"Bone White|XL":5}'::jsonb,
   'https://images.unsplash.com/photo-1503341504253-dff4815485f1?auto=format&fit=crop&w=1200&q=80',
   array[
     'https://images.unsplash.com/photo-1503341504253-dff4815485f1?auto=format&fit=crop&w=1200&q=80',
     'https://images.unsplash.com/photo-1562157873-818bc0726f68?auto=format&fit=crop&w=1200&q=80'
   ]::text[],
   false, true),

  -- 11 --------------------------------------------------------------------
  ('Sable Puffer Vest', 'sable-puffer-vest', 'Jackets', 'Kaal Vastr', 'KV-JK-011',
   'Insulated puffer vest with a matte shell, silicone-branded zip pull and an internal media pocket. Sits cleanly over knitwear.',
   5999, 6999,
   array['S','M','L','XL']::text[],
   array['Sable Black','Ash']::text[],
   '{"Sable Black|S":3,"Sable Black|M":5,"Sable Black|L":4,"Sable Black|XL":1,"Ash|S":0,"Ash|M":2,"Ash|L":2,"Ash|XL":0}'::jsonb,
   'https://images.unsplash.com/photo-1591047139829-d91aecb6caea?auto=format&fit=crop&w=1200&q=80',
   array[
     'https://images.unsplash.com/photo-1591047139829-d91aecb6caea?auto=format&fit=crop&w=1200&q=80',
     'https://images.unsplash.com/photo-1603252109303-2751441dd157?auto=format&fit=crop&w=1200&q=80'
   ]::text[],
   false, true),

  -- 12 --------------------------------------------------------------------
  ('KV Signature Cap', 'kv-signature-cap', 'Accessories', 'Kaal Vastr', 'KV-AC-012',
   'Six-panel structured cap in brushed cotton twill with a tonal embroidered KV monogram and a metal adjuster.',
   899, null,
   array['One Size']::text[],
   array['Obsidian Black','Stone Grey']::text[],
   '{"Obsidian Black|One Size":22,"Stone Grey|One Size":9}'::jsonb,
   'https://images.unsplash.com/photo-1521369909029-2afed882baee?auto=format&fit=crop&w=1200&q=80',
   array[
     'https://images.unsplash.com/photo-1521369909029-2afed882baee?auto=format&fit=crop&w=1200&q=80',
     'https://images.unsplash.com/photo-1588850561407-ed78c282e89b?auto=format&fit=crop&w=1200&q=80'
   ]::text[],
   false, true)

on conflict (sku) do update set
  name             = excluded.name,
  slug             = excluded.slug,
  category         = excluded.category,
  description      = excluded.description,
  selling_price    = excluded.selling_price,
  compare_at_price = excluded.compare_at_price,
  sizes            = excluded.sizes,
  colors           = excluded.colors,
  variant_stock    = excluded.variant_stock,
  image_url        = excluded.image_url,
  images           = excluded.images,
  is_featured      = excluded.is_featured,
  is_available     = excluded.is_available,
  is_archived      = false,
  updated_at       = now();

-- ###########################################################################
-- FILE: supabase/migrations/20260101000600_customer_accounts.sql
-- ###########################################################################
-- ===========================================================================
-- Kaal Vastr — 006 customer accounts
--
-- Customers can register, verify their email with a 6-digit code and sign in.
-- An account gives them a saved address book and a record of the orders they
-- sent over WhatsApp. WhatsApp remains the payment/confirmation channel; this
-- schema only remembers what the customer asked for.
--
-- Access model:
--   addresses    read/write: owner (admins read all)
--   orders       read/write: owner (admins read all)
--   order_items  read/write: via the parent order's owner
--   profiles     gains `phone`, self-service, still role-locked
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- profiles: a contact number so checkout can prefill itself.
-- ---------------------------------------------------------------------------
alter table public.profiles
  add column if not exists phone text;

create index if not exists profiles_phone_idx
  on public.profiles (phone)
  where phone is not null;

-- Carry the number supplied at registration into the profile row.
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
  insert into public.profiles (id, email, phone, full_name, role)
  values (
    new.id,
    coalesce(new.email, 'phone-' || new.id::text),
    nullif(btrim(coalesce(new.raw_user_meta_data ->> 'phone', '')), ''),
    coalesce(new.raw_user_meta_data ->> 'full_name', ''),
    'customer'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- addresses — the customer's saved delivery addresses.
-- ---------------------------------------------------------------------------
create table if not exists public.addresses (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid        not null references auth.users (id) on delete cascade,
  label       text        not null default 'Home',
  full_name   text        not null default '',
  phone       text        not null default '',
  line1       text        not null default '',
  line2       text,
  city        text        not null default '',
  state       text        not null default '',
  pincode     text        not null default '',
  landmark    text,
  is_default  boolean     not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  constraint addresses_label_present   check (length(btrim(label)) > 0),
  constraint addresses_line1_present   check (length(btrim(line1)) > 0),
  constraint addresses_city_present    check (length(btrim(city)) > 0),
  constraint addresses_pincode_present check (length(btrim(pincode)) > 0)
);

comment on table public.addresses is
  'Customer saved delivery addresses. Owner-scoped; admins may read all.';
comment on column public.addresses.is_default is
  'The address preselected at checkout. Enforced unique-per-user below.';

create index if not exists addresses_user_idx on public.addresses (user_id, created_at desc);

-- At most one default address per customer.
create unique index if not exists addresses_one_default_idx
  on public.addresses (user_id)
  where is_default;

-- Choosing a new default demotes the previous one in the same transaction.
create or replace function public.addresses_keep_single_default()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.is_default then
    update public.addresses
       set is_default = false
     where user_id = new.user_id
       and is_default
       and id <> new.id;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_addresses_single_default on public.addresses;
create trigger trg_addresses_single_default
  before insert or update of is_default on public.addresses
  for each row execute function public.addresses_keep_single_default();

drop trigger if exists trg_addresses_updated_at on public.addresses;
create trigger trg_addresses_updated_at
  before update on public.addresses
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- orders — one row per order the customer sent to WhatsApp.
-- `reference` is the human-facing id that also appears in the WhatsApp message.
-- ---------------------------------------------------------------------------
create table if not exists public.orders (
  id           uuid primary key default gen_random_uuid(),
  reference    text        not null,
  user_id      uuid        not null references auth.users (id) on delete cascade,
  status       text        not null default 'sent_to_whatsapp'
                 check (status in ('sent_to_whatsapp', 'cancelled')),
  item_count   integer     not null default 0 check (item_count >= 0),
  subtotal     numeric(10,2) not null default 0 check (subtotal >= 0),
  savings      numeric(10,2) not null default 0 check (savings >= 0),
  total        numeric(10,2) not null default 0 check (total >= 0),
  customer_name  text      not null default '',
  customer_phone text      not null default '',
  notes        text,
  address_id   uuid references public.addresses (id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),

  constraint orders_reference_present check (length(btrim(reference)) > 0),
  constraint orders_reference_unique unique (reference)
);

comment on table public.orders is
  'Orders the customer initiated from the storefront. The store confirms '
  'delivery and payment over WhatsApp; this row is the customer''s own record.';
comment on column public.orders.status is
  'sent_to_whatsapp = the customer handed the order to WhatsApp. '
  'cancelled = the customer withdrew it. Stock is not reserved by this row.';

create index if not exists orders_user_idx on public.orders (user_id, created_at desc);

drop trigger if exists trg_orders_updated_at on public.orders;
create trigger trg_orders_updated_at
  before update on public.orders
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- order_items — a price snapshot, so a later catalogue edit cannot rewrite
-- what the customer actually asked for. product_id is kept for reference and
-- set to null if the product is deleted.
-- ---------------------------------------------------------------------------
create table if not exists public.order_items (
  id              uuid primary key default gen_random_uuid(),
  order_id        uuid          not null references public.orders (id) on delete cascade,
  product_id      uuid          references public.products (id) on delete set null,
  name            text          not null,
  slug            text,
  sku             text,
  image           text,
  color           text,
  size            text,
  unit_price      numeric(10,2) not null check (unit_price >= 0),
  compare_at_price numeric(10,2) check (compare_at_price is null or compare_at_price >= 0),
  quantity        integer       not null check (quantity > 0),
  line_total      numeric(10,2) not null check (line_total >= 0),

  constraint order_items_name_present check (length(btrim(name)) > 0)
);

comment on table public.order_items is
  'Immutable line-item snapshot taken at checkout.';

create index if not exists order_items_order_idx on public.order_items (order_id);

-- ---------------------------------------------------------------------------
-- Row level security.
--
-- Customers only ever see their own rows. Admins read everything for
-- fulfilment. Customers may insert their own orders (checkout) and cancel
-- them, but they cannot rewrite prices or item counts after the fact: the
-- update policy is limited to `status` and `notes`.
-- ---------------------------------------------------------------------------
alter table public.addresses enable row level security;
alter table public.orders     enable row level security;
alter table public.order_items enable row level security;

drop policy if exists "addresses_owner_read" on public.addresses;
create policy "addresses_owner_read"
  on public.addresses for select
  using (auth.uid() = user_id or public.is_admin());

drop policy if exists "addresses_owner_insert" on public.addresses;
create policy "addresses_owner_insert"
  on public.addresses for insert
  with check (auth.uid() = user_id);

drop policy if exists "addresses_owner_update" on public.addresses;
create policy "addresses_owner_update"
  on public.addresses for update
  using (auth.uid() = user_id or public.is_admin())
  with check (auth.uid() = user_id or public.is_admin());

drop policy if exists "addresses_owner_delete" on public.addresses;
create policy "addresses_owner_delete"
  on public.addresses for delete
  using (auth.uid() = user_id or public.is_admin());

drop policy if exists "orders_owner_read" on public.orders;
create policy "orders_owner_read"
  on public.orders for select
  using (auth.uid() = user_id or public.is_admin());

drop policy if exists "orders_owner_insert" on public.orders;
create policy "orders_owner_insert"
  on public.orders for insert
  with check (auth.uid() = user_id);

-- Customers may only cancel; totals and line items are not customer-editable.
drop policy if exists "orders_owner_update" on public.orders;
create policy "orders_owner_update"
  on public.orders for update
  using (auth.uid() = user_id or public.is_admin())
  with check (auth.uid() = user_id or public.is_admin());

drop policy if exists "orders_owner_delete" on public.orders;
create policy "orders_owner_delete"
  on public.orders for delete
  using (auth.uid() = user_id or public.is_admin());

drop policy if exists "order_items_read_via_order" on public.order_items;
create policy "order_items_read_via_order"
  on public.order_items for select
  using (
    exists (
      select 1 from public.orders o
      where o.id = order_id
        and (o.user_id = auth.uid() or public.is_admin())
    )
  );

drop policy if exists "order_items_insert_via_order" on public.order_items;
create policy "order_items_insert_via_order"
  on public.order_items for insert
  with check (
    exists (
      select 1 from public.orders o
      where o.id = order_id
        and (o.user_id = auth.uid() or public.is_admin())
    )
  );

-- Line items are a snapshot: readable and insertable with the order, never
-- updated or deleted by the customer.
drop policy if exists "order_items_admin_mutate" on public.order_items;
create policy "order_items_admin_mutate"
  on public.order_items for all
  using (public.is_admin())
  with check (public.is_admin());

-- ---------------------------------------------------------------------------
-- The unique reference is generated by the client (it is shown to the customer
-- in the WhatsApp message), so a collision must not surface as a raw 23505.
-- ---------------------------------------------------------------------------
create or replace function public.new_order_reference()
returns text
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  candidate text;
begin
  loop
    candidate := 'KV-'
      || to_char(now() at time zone 'Asia/Kolkata', 'YYMMDD')
      || '-'
      || upper(substr(encode(gen_random_bytes(3), 'hex'), 1, 6));

    exit when not exists (select 1 from public.orders where reference = candidate);
  end loop;

  return candidate;
end;
$$;

revoke all on function public.new_order_reference() from public, anon;
grant execute on function public.new_order_reference() to authenticated;

-- ---------------------------------------------------------------------------
-- Column privileges.
--
-- Supabase grants blanket ALL on new public tables, so narrow the order table
-- explicitly: a customer (or anyone acting through the `authenticated` role)
-- may correct contact details or cancel, but never restate a price or total.
-- The totals themselves are owned by the recalculation trigger below.
-- ---------------------------------------------------------------------------
revoke update on public.orders from anon, authenticated;
grant update (customer_name, customer_phone, notes, status) on public.orders to authenticated;

revoke update, delete on public.order_items from anon, authenticated;
grant insert, select on public.order_items to authenticated;

-- ---------------------------------------------------------------------------
-- Totals are never client-supplied: inserting or removing a line recomputes
-- item_count / subtotal / savings / total on the parent order. The trigger is
-- SECURITY DEFINER because the customer inserting the line is not allowed to
-- update the order's money columns directly.
-- ---------------------------------------------------------------------------
create or replace function public.order_items_recalc_order()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  target uuid := coalesce(new.order_id, old.order_id);
begin
  update public.orders o
     set item_count = totals.units,
         subtotal   = totals.subtotal,
         savings    = totals.savings,
         total      = totals.subtotal
    from (
      select
        coalesce(sum(i.quantity), 0)::integer as units,
        coalesce(sum(i.unit_price * i.quantity), 0) as subtotal,
        coalesce(sum(greatest(coalesce(i.compare_at_price, i.unit_price) - i.unit_price, 0) * i.quantity), 0) as savings
      from public.order_items i
      where i.order_id = target
    ) totals
   where o.id = target;

  return null;
end;
$$;

drop trigger if exists trg_order_items_recalc on public.order_items;
create trigger trg_order_items_recalc
  after insert or update or delete on public.order_items
  for each row execute function public.order_items_recalc_order();

-- ###########################################################################
-- FILE: supabase/migrations/20260101000700_order_owner_defaults.sql
-- ###########################################################################
-- ===========================================================================
-- Kaal Vastr — 007 owner columns are assigned by the database
--
-- 006 left `addresses.user_id` and `orders.user_id` to be supplied by the
-- client. That is both awkward and unsafe: the browser would have to echo back
-- a user id, and `with check (auth.uid() = user_id)` would reject every insert
-- that omitted it. RLS is the backstop, but the owner should not be client
-- input at all.
--
-- These BEFORE INSERT triggers stamp the owner from the verified JWT, and
-- generate the human-facing order reference server-side. Client-supplied
-- values are ignored whenever there is a session, so a crafted payload cannot
-- file an order or an address under somebody else's account. Service-role and
-- SQL-editor inserts (no JWT) may still set them explicitly.
-- ===========================================================================

create or replace function public.addresses_assign_owner()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is not null then
    new.user_id := auth.uid();
  elsif new.user_id is null then
    raise exception 'addresses.user_id is required when there is no authenticated session'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_addresses_assign_owner on public.addresses;
create trigger trg_addresses_assign_owner
  before insert on public.addresses
  for each row execute function public.addresses_assign_owner();


create or replace function public.orders_assign_owner()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is not null then
    new.user_id := auth.uid();

    -- The reference is shown to the customer in the WhatsApp message, so it is
    -- generated once, here, and the recorded order can never disagree with it.
    if new.reference is null or btrim(new.reference) = '' then
      new.reference := public.new_order_reference();
    end if;
  else
    if new.user_id is null then
      raise exception 'orders.user_id is required when there is no authenticated session'
        using errcode = '42501';
    end if;

    if new.reference is null or btrim(new.reference) = '' then
      new.reference := public.new_order_reference();
    end if;
  end if;

  -- The money columns are owned by the order_items recalculation trigger. Clear
  -- whatever the client claimed so a stored order can never disagree with its
  -- own line items.
  new.item_count := 0;
  new.subtotal   := 0;
  new.savings    := 0;
  new.total      := 0;

  return new;
end;
$$;

drop trigger if exists trg_orders_assign_owner on public.orders;
create trigger trg_orders_assign_owner
  before insert on public.orders
  for each row execute function public.orders_assign_owner();

-- A customer cancelling must not be able to flip the status to an unknown
-- value; the column check already constrains it, this just documents intent.
comment on column public.orders.reference is
  'Human-facing order id, generated server-side. Also included in the WhatsApp '
  'message so the customer and the store refer to the same order.';
comment on column public.orders.total is
  'Always derived from order_items by trg_order_items_recalc. Never client input.';

-- ###########################################################################
-- FILE: supabase/migrations/20260101000800_fix_order_reference_generator.sql
-- ###########################################################################
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

-- ###########################################################################
-- FILE: supabase/migrations/20260101000900_lock_function_privileges.sql
-- ###########################################################################
-- ===========================================================================
-- Kaal Vastr — 009 lock down function execution privileges
--
-- Supabase's default privileges grant EXECUTE on every new function in the
-- public schema to PUBLIC (and therefore to anon and authenticated). Most of
-- this schema's functions are SECURITY DEFINER triggers, which have no reason
-- to be callable by a request at all:
--
--   handle_new_user, set_updated_at, products_sync_total_stock,
--   products_variant_stock_is_valid, products_compare_price_is_valid,
--   addresses_assign_owner, addresses_keep_single_default,
--   orders_assign_owner, order_items_recalc_order
--
-- Calling a trigger function directly cannot corrupt anything (the `new`
-- record is unassigned, so it errors), but it is needless surface area, and
-- `is_admin()` / `is_staff_or_admin()` genuinely are callable zero-argument
-- SECURITY DEFINER functions.
--
-- The RLS helper functions are the deliberate exception. Policies are OR'd
-- together, so if the querying role cannot execute a function referenced by
-- *any* policy the entire statement fails with permission denied. Public
-- product reads depend on that, so the helpers stay executable by the roles
-- whose policies call them, and nothing more.
--
-- Extension-owned functions (pg_trgm) are left untouched.
-- ===========================================================================

-- Trigger and maintenance functions: no role needs to call these directly.
-- PostgreSQL does not re-check EXECUTE when it fires a trigger, so revoking
-- here cannot break the triggers themselves.
do $$
declare
  fn record;
begin
  for fn in
    select p.oid::regprocedure as signature
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = any (array[
        'handle_new_user',
        'set_updated_at',
        'products_sync_total_stock',
        'products_variant_stock_is_valid',
        'products_compare_price_is_valid',
        'addresses_assign_owner',
        'addresses_keep_single_default',
        'orders_assign_owner',
        'order_items_recalc_order'
      ])
  loop
    execute format('revoke all on function %s from public, anon, authenticated', fn.signature);
  end loop;
end;
$$;

-- RLS helpers. These are referenced inside row level security policies, so the
-- role running the query must be able to execute them.
revoke all on function public.is_admin()                from public, anon, authenticated;
revoke all on function public.is_staff_or_admin()       from public, anon, authenticated;
grant execute on function public.is_admin()             to anon, authenticated;
grant execute on function public.is_staff_or_admin()    to anon, authenticated;

revoke all on function public.my_profile_role()         from public, anon, authenticated;
revoke all on function public.my_profile_is_active()    from public, anon, authenticated;
grant execute on function public.my_profile_role()      to authenticated;
grant execute on function public.my_profile_is_active() to authenticated;

-- `promote_to_admin` is deliberately absent here. It is created by migration
-- 010, which also does its own revoke/grant. Granting it from this migration
-- would fail on a clean install, where the function does not exist yet.

revoke all on function public.new_order_reference()     from public, anon, authenticated;
grant execute on function public.new_order_reference()  to authenticated;

notify pgrst, 'reload schema';

-- ###########################################################################
-- FILE: supabase/migrations/20260101001000_staff_account_lifecycle.sql
-- ###########################################################################
-- ===========================================================================
-- Kaal Vastr — 010 staff account lifecycle
--
-- Staff accounts are created by an admin (there is no public staff signup) and
-- must verify their email with a 6-digit code before they can do anything. The
-- profiles table therefore needs to record the credential lifecycle, not just
-- the role:
--
--   invited     created by an admin, email not yet confirmed
--   active      email confirmed, account usable
--   suspended   blocked by an admin, cannot sign in to the dashboard
--
-- `email_verified_at` is mirrored from auth.users by a trigger rather than
-- trusted from the client, so a staff member cannot mark themselves verified.
-- ===========================================================================

alter table public.profiles
  add column if not exists status text not null default 'active',
  add column if not exists email_verified_at timestamptz,
  add column if not exists invited_by uuid references public.profiles (id) on delete set null,
  add column if not exists invited_at timestamptz,
  add column if not exists activated_at timestamptz,
  add column if not exists suspended_at timestamptz;

-- Replace rather than add, so the constraint is present exactly once no matter
-- which install path ran.
alter table public.profiles drop constraint if exists profiles_status_check;
alter table public.profiles add constraint profiles_status_check
  check (status in ('invited', 'active', 'suspended'));

-- A suspended account is never active, and an invited one has not verified yet.
alter table public.profiles drop constraint if exists profiles_suspended_flag;
alter table public.profiles add constraint profiles_suspended_flag
  check (
    (status = 'suspended' and is_active = false)
    or (status <> 'suspended')
  );

create index if not exists profiles_role_status_idx on public.profiles (role, status);

comment on column public.profiles.status is
  'invited = admin created it, email not confirmed. active = usable. '
  'suspended = admin blocked it; is_active is forced false in the same check.';
comment on column public.profiles.email_verified_at is
  'Mirrored from auth.users.email_confirmed_at by a trigger. Never client input.';

-- ---------------------------------------------------------------------------
-- Mirror email verification out of auth.users.
--
-- UPDATE only, never INSERT: on INSERT the row is still unconfirmed, and
-- handle_new_user may not have written the profile row yet, so firing here
-- would race with it. Accounts created already-confirmed (the admin staff
-- flow) set email_verified_at explicitly.
-- ---------------------------------------------------------------------------
create or replace function public.sync_profile_verification()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.email_confirmed_at is null then
    return null;
  end if;

  update public.profiles
     set email_verified_at = coalesce(email_verified_at, new.email_confirmed_at),
         -- An invited account becomes usable the moment it is verified.
         status = case when status = 'invited' then 'active' else status end,
         activated_at = case when status = 'invited' then now() else activated_at end
   where id = new.id
     and email_verified_at is null;

  return null;
end;
$$;

drop trigger if exists trg_auth_user_verified on auth.users;
create trigger trg_auth_user_verified
  after update of email_confirmed_at on auth.users
  for each row execute function public.sync_profile_verification();

revoke all on function public.sync_profile_verification() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Audit trail for credential events.
--
-- Deliberately holds no secrets: no password, no token, no OTP code. It records
-- that an invite was sent and when, which is what the admin UI shows as
-- "invite sent" / "verified" / "active".
-- ---------------------------------------------------------------------------
create table if not exists public.staff_account_events (
  id         uuid primary key default gen_random_uuid(),
  profile_id uuid        not null references public.profiles (id) on delete cascade,
  actor_id   uuid        references public.profiles (id) on delete set null,
  kind       text        not null,
  detail     text,
  created_at timestamptz not null default now(),

  constraint staff_account_events_kind_check check (
    kind in (
      'invite_sent',
      'invite_resent',
      'password_reset_sent',
      'email_verified',
      'role_changed',
      'suspended',
      'reactivated'
    )
  ),
  constraint staff_account_events_detail_len check (detail is null or length(detail) <= 500)
);

comment on table public.staff_account_events is
  'Audit trail of staff credential lifecycle events. Contains no passwords, '
  'tokens or one-time codes by design.';

create index if not exists staff_account_events_profile_idx
  on public.staff_account_events (profile_id, created_at desc);

alter table public.staff_account_events enable row level security;

-- Admins read the audit trail. Writes only ever happen inside SECURITY DEFINER
-- functions (or via the service role), so no insert policy is exposed.
drop policy if exists "staff_account_events_admin_read" on public.staff_account_events;
create policy "staff_account_events_admin_read"
  on public.staff_account_events for select
  using (public.is_admin());

revoke insert, update, delete on public.staff_account_events from anon, authenticated;
revoke all on table public.staff_account_events from anon;
grant select on public.staff_account_events to authenticated;

-- Staff may not read the credential audit trail; that view is admin-only.
drop policy if exists "staff_account_events_staff_read" on public.staff_account_events;

-- ---------------------------------------------------------------------------
-- Who is allowed to change a role.
--
-- handle_new_user always forces role = 'customer' and deliberately ignores any
-- role supplied in signup metadata, because signUp lets an anonymous visitor
-- put anything in user_metadata. Promotion happens only through these
-- SECURITY DEFINER functions, which read the caller's role from the database.
-- ---------------------------------------------------------------------------
create or replace function public.profiles_role_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- No session means the service role or the SQL editor, which is trusted.
  if auth.uid() is not null and not public.is_admin() then
    raise exception 'only an admin may change roles'
      using errcode = '42501';
  end if;

  -- A role change always implies a usable account, and clearing the suspension
  -- columns here keeps profiles_suspended_flag satisfied.
  if new.role = 'customer' then
    new.status := 'active';
    new.is_active := true;
  elsif new.status = 'suspended' then
    new.is_active := false;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_profiles_role_guard on public.profiles;
drop trigger if exists trg_profiles_role_change on public.profiles;
create trigger trg_profiles_role_change
  before update of role on public.profiles
  for each row execute function public.profiles_role_guard();

revoke all on function public.profiles_role_guard() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Admin role changes.
--
-- promote_to_admin keeps its original `returns text` signature so it can be
-- replaced in place, and stays strictly admin-only. It is deliberately NOT able
-- to bootstrap the first admin: a "no admin exists yet" branch would let any
-- signed-in customer promote themselves, and the first admin is created by the
-- documented direct SQL statement in supabase/bootstrap.sql instead.
-- ---------------------------------------------------------------------------
create or replace function public.promote_to_admin(target_email text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  target_id uuid;
begin
  if not public.is_admin() then
    raise exception 'only an existing admin can promote an account'
      using errcode = '42501';
  end if;

  select p.id into target_id
    from public.profiles p
   where lower(p.email) = lower(btrim(target_email));

  if target_id is null then
    raise exception 'no profile exists for that email address'
      using errcode = 'P0002';
  end if;

  update public.profiles
     set role = 'admin',
         status = 'active',
         is_active = true,
         suspended_at = null,
         activated_at = coalesce(activated_at, now())
   where id = target_id;

  insert into public.staff_account_events (profile_id, actor_id, kind, detail)
  values (target_id, auth.uid(), 'role_changed', 'promoted to admin');

  return lower(btrim(target_email));
end;
$$;

revoke all on function public.promote_to_admin(text) from public, anon;
grant execute on function public.promote_to_admin(text) to authenticated;

-- ---------------------------------------------------------------------------
-- Set or clear a staff account's role and suspension, with an audit entry.
-- Used by the admin "Staff & Admin Accounts" screen.
-- ---------------------------------------------------------------------------
create or replace function public.set_account_role(
  target_email text,
  new_role     text,
  suspend      boolean default false
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  target_id uuid;
  applied   text;
begin
  if not public.is_admin() then
    raise exception 'only an existing admin can manage staff accounts'
      using errcode = '42501';
  end if;

  if new_role not in ('customer', 'staff', 'admin') then
    raise exception 'unknown role %', new_role using errcode = '22023';
  end if;

  select p.id into target_id
    from public.profiles p
   where lower(p.email) = lower(btrim(target_email));

  if target_id is null then
    raise exception 'no profile exists for that email address'
      using errcode = 'P0002';
  end if;

  if target_id = auth.uid() and suspend then
    raise exception 'you cannot suspend your own account' using errcode = '22023';
  end if;

  update public.profiles
     set role          = new_role,
         status        = case when suspend then 'suspended' else 'active' end,
         is_active     = not suspend,
         suspended_at  = case when suspend then now() else null end
   where id = target_id;

  applied := new_role || (case when suspend then ' (suspended)' else '' end);

  insert into public.staff_account_events (profile_id, actor_id, kind, detail)
  values (
    target_id,
    auth.uid(),
    case when suspend then 'suspended' else 'reactivated' end,
    applied
  );

  return applied;
end;
$$;

revoke all on function public.set_account_role(text, text, boolean) from public, anon;
grant execute on function public.set_account_role(text, text, boolean) to authenticated;

notify pgrst, 'reload schema';

-- ###########################################################################
-- FILE: supabase/migrations/20260101001100_dispatch_status.sql
-- ###########################################################################
-- ===========================================================================
-- Kaal Vastr — 011 dispatch status and who may change it
--
-- Requirement: staff own the dispatch log; admins may read it but must not be
-- able to change it, enforced in the database and not just in the UI.
--
-- A plain RLS policy cannot express "staff may UPDATE, admin may SELECT" while
-- both roles share the same Postgres role (`authenticated`) and the same table
-- privileges. Column-level grants do not help either, because they are granted
-- per role rather than per user. So nobody gets direct UPDATE on orders at all;
-- status changes go through a SECURITY DEFINER function that checks the
-- caller's role in profiles and raises for anyone who is not staff. An admin
-- calling it is rejected by the database, not merely by a disabled button.
--
-- Customers keep read access to their own history, can flag a cancellation, and
-- can no longer write `status` themselves.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Snapshot the delivery address on the order.
--
-- The order referenced the customer's address by id, so deleting or editing an
-- address silently rewrote the delivery details of orders already placed. The
-- WhatsApp message and the dispatch log both need the address as it was when
-- the customer ordered, so store a copy.
-- ---------------------------------------------------------------------------
alter table public.orders
  add column if not exists delivery jsonb;

comment on column public.orders.delivery is
  'Snapshot of the chosen address taken at checkout. Kept so a later address '
  'edit or delete cannot rewrite the delivery details of a placed order.';

-- ---------------------------------------------------------------------------
-- 2. Replace the two-state status with the dispatch lifecycle.
-- ---------------------------------------------------------------------------
update public.orders set status = 'placed' where status = 'sent_to_whatsapp';

alter table public.orders drop constraint if exists orders_status_check;
alter table public.orders add constraint orders_status_check
  check (status in ('placed', 'contacted', 'dispatched', 'delivered', 'cancelled'));

alter table public.orders alter column status set default 'placed';

alter table public.orders
  add column if not exists cancel_requested boolean not null default false,
  add column if not exists status_note text,
  add column if not exists status_updated_at timestamptz,
  add column if not exists status_updated_by uuid references public.profiles (id) on delete set null,
  add column if not exists contacted_at timestamptz,
  add column if not exists dispatched_at timestamptz,
  add column if not exists delivered_at timestamptz;

comment on column public.orders.status is
  'Dispatch state. Only staff may change it, via set_order_status(). '
  'delivered and cancelled are terminal.';
comment on column public.orders.cancel_requested is
  'Set by the customer. Staff action the request with set_order_status().';

create index if not exists orders_status_created_idx on public.orders (status, created_at desc);
create index if not exists orders_cancel_requested_idx
  on public.orders (created_at desc)
  where cancel_requested;

-- ---------------------------------------------------------------------------
-- 3. Take direct UPDATE away from every client role.
-- ---------------------------------------------------------------------------
revoke update on public.orders from anon, authenticated;

-- The customer's old "cancel your own order" policy goes away entirely.
drop policy if exists "orders_owner_update" on public.orders;

-- Staff need to read the whole log; customers only their own rows.
--
-- The drop of the *old* name above is not enough for a re-run. `orders_read` is
-- a new name, so nothing removes the copy this migration created the first time
-- it ran, and the second run of supabase/apply-all.sql aborts with
-- `policy "orders_read" for table "orders" already exists`. Since apply-all.sql
-- is documented as an idempotent installer, it has to drop what it creates.
drop policy if exists "orders_owner_read" on public.orders;
drop policy if exists "orders_read" on public.orders;
create policy "orders_read"
  on public.orders for select
  using (auth.uid() = user_id or public.is_staff_or_admin());

-- Admin-only insert/delete stay as they were: an order is created by its
-- owner at checkout, and admins keep the ability to remove a duplicate.
drop policy if exists "orders_owner_insert" on public.orders;
create policy "orders_owner_insert"
  on public.orders for insert
  with check (auth.uid() = user_id);

-- Line items are part of the dispatch log, so admins lose the ability to
-- rewrite or delete them as well. They remain readable and insertable with
-- their parent order.
drop policy if exists "order_items_admin_mutate" on public.order_items;

drop policy if exists "order_items_read_via_order" on public.order_items;
create policy "order_items_read_via_order"
  on public.order_items for select
  using (
    exists (
      select 1 from public.orders o
      where o.id = order_id
        and (o.user_id = auth.uid() or public.is_staff_or_admin())
    )
  );

drop policy if exists "order_items_insert_via_order" on public.order_items;
create policy "order_items_insert_via_order"
  on public.order_items for insert
  with check (
    exists (
      select 1 from public.orders o
      where o.id = order_id
        and (o.user_id = auth.uid() or public.is_staff_or_admin())
    )
  );

revoke update, delete on public.order_items from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. Staff-only dispatch transitions.
--
-- Terminal states are final, and a cancellation request is cleared once staff
-- act on it. Every change is attributed to the staff member who made it.
-- ---------------------------------------------------------------------------
create or replace function public.set_order_status(
  p_order_id uuid,
  p_status   text,
  p_note     text default null
)
returns public.orders
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_role text;
  current_row public.orders;
  updated     public.orders;
begin
  -- The whole point of this function: role is read from the database, not from
  -- anything the caller sent. An admin is rejected here even though the admin
  -- is allowed to read the log.
  select my_profile_role() into actor_role;

  if actor_role is distinct from 'staff' then
    raise exception 'only staff may update dispatch status (you are %)',
      coalesce(actor_role, 'not signed in')
      using errcode = '42501';
  end if;

  if p_status not in ('placed', 'contacted', 'dispatched', 'delivered', 'cancelled') then
    raise exception 'unknown dispatch status %', p_status using errcode = '22023';
  end if;

  select * into current_row from public.orders where id = p_order_id for update;

  if current_row.id is null then
    raise exception 'order % not found', p_order_id using errcode = 'P0002';
  end if;

  if current_row.status in ('delivered', 'cancelled') then
    raise exception 'order % is % and can no longer change', current_row.reference, current_row.status
      using errcode = '22023';
  end if;

  -- Keep the history honest: only move forward, with cancellation as the way out.
  if p_status <> 'cancelled' then
    if current_row.status = 'dispatched' and p_status in ('placed', 'contacted') then
      raise exception 'order % has already been dispatched', current_row.reference
        using errcode = '22023';
    end if;
  end if;

  update public.orders
     set status            = p_status,
         status_note       = nullif(btrim(coalesce(p_note, '')), ''),
         status_updated_at = now(),
         status_updated_by = auth.uid(),
         contacted_at      = case when p_status = 'contacted' then coalesce(contacted_at, now()) else contacted_at end,
         dispatched_at     = case when p_status = 'dispatched' then coalesce(dispatched_at, now()) else dispatched_at end,
         delivered_at      = case when p_status = 'delivered' then coalesce(delivered_at, now()) else delivered_at end,
         cancel_requested  = case when p_status = 'cancelled' then false else cancel_requested end
   where id = p_order_id
   returning * into updated;

  return updated;
end;
$$;

revoke all on function public.set_order_status(uuid, text, text) from public, anon;
grant execute on function public.set_order_status(uuid, text, text) to authenticated;

comment on function public.set_order_status(uuid, text, text) is
  'Staff-only dispatch transition. Rejects admins and non-staff callers in the '
  'database, so the read-only admin view cannot be bypassed by crafting a request.';

-- ---------------------------------------------------------------------------
-- 5. Customers can ask to cancel, but only while it is still sensible.
-- ---------------------------------------------------------------------------
create or replace function public.request_order_cancellation(p_order_id uuid)
returns public.orders
language plpgsql
security definer
set search_path = public
as $$
declare
  current_row public.orders;
  updated     public.orders;
begin
  if auth.uid() is null then
    raise exception 'sign in to request a cancellation' using errcode = '42501';
  end if;

  select * into current_row from public.orders where id = p_order_id for update;

  if current_row.id is null then
    raise exception 'order % not found', p_order_id using errcode = 'P0002';
  end if;

  if current_row.user_id <> auth.uid() then
    -- Deliberately the same error as "not found", so this cannot be used to
    -- probe for the existence of somebody else's order.
    raise exception 'order % not found', p_order_id using errcode = 'P0002';
  end if;

  if current_row.status in ('dispatched', 'delivered', 'cancelled') then
    raise exception 'order % is already %', current_row.reference, current_row.status
      using errcode = '22023';
  end if;

  if current_row.cancel_requested then
    return current_row;
  end if;

  update public.orders
     set cancel_requested = true
   where id = p_order_id
   returning * into updated;

  return updated;
end;
$$;

revoke all on function public.request_order_cancellation(uuid) from public, anon;
grant execute on function public.request_order_cancellation(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. Staff sign-in gate.
--
-- A suspended or still-invited account must not reach the dispatch log even
-- though its role says staff. is_active and status are checked here so the
-- frontend and the database agree.
-- ---------------------------------------------------------------------------
create or replace function public.can_use_staff_console()
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  p public.profiles;
begin
  select * into p from public.profiles where id = auth.uid();

  if p.id is null then
    return false;
  end if;

  return p.role in ('staff', 'admin') and p.is_active and p.status = 'active';
end;
$$;

revoke all on function public.can_use_staff_console() from public, anon;
grant execute on function public.can_use_staff_console() to authenticated;

notify pgrst, 'reload schema';

-- ###########################################################################
-- FILE: supabase/migrations/20260101001200_realtime_publication.sql
-- ###########################################################################
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

-- ###########################################################################
-- FILE: supabase/migrations/20260101001300_profile_column_limits.sql
-- ###########################################################################
-- ===========================================================================
-- Kaal Vastr — 013 self-service column limits, monotonic dispatch, honest
--               error codes
--
-- Found by scripts/verify-staff-dispatch.mjs against the live database.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. A profile may only edit its own name and phone.
--
-- profiles_update_own is scoped by row, not by column, so any signed-in
-- account could previously PATCH its own row. Two consequences, both bad:
--
--   * an unverified staff member could set email_verified_at and appear in the
--     admin's staff list as verified without ever entering a code;
--   * a SUSPENDED staff member could set status = 'active', is_active = true
--     and suspended_at = null, which is exactly what can_use_staff_console()
--     checks -- a self-reinstatement that the role guard never sees, because
--     that trigger only fires on changes to `role`.
--
-- Role and suspension are changed exclusively through set_account_role() and
-- promote_to_admin(), which re-check the caller's role as admin.
-- ---------------------------------------------------------------------------
revoke update on public.profiles from anon, authenticated;
grant update (full_name, phone) on public.profiles to authenticated;

comment on column public.profiles.email_verified_at is
  'Mirrored from auth.users.email_confirmed_at by a trigger. Not client '
  'writable: only full_name and phone are self-service.';

-- ---------------------------------------------------------------------------
-- 2. Dispatch status only moves forward.
--
-- The previous guard blocked dispatched -> placed/contacted but allowed
-- contacted -> placed, so a staff member could quietly reset an order's
-- progress and lose the contacted_at trail. Status now has a rank and may only
-- increase, except for cancellation, which is always allowed until terminal.
-- ---------------------------------------------------------------------------
create or replace function public.set_order_status(
  p_order_id uuid,
  p_status   text,
  p_note     text default null
)
returns public.orders
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_role   text;
  current_row  public.orders;
  updated      public.orders;
  current_rank integer;
  target_rank  integer;
begin
  -- Role comes from the database, never from the request. This is what makes
  -- the admin view genuinely read-only rather than merely read-only in the UI.
  select my_profile_role() into actor_role;

  if actor_role is distinct from 'staff' then
    raise exception 'only staff may update dispatch status (you are %)',
      coalesce(actor_role, 'not signed in')
      using errcode = '42501';
  end if;

  if p_status not in ('placed', 'contacted', 'dispatched', 'delivered', 'cancelled') then
    raise exception 'unknown dispatch status %', p_status using errcode = '22023';
  end if;

  select * into current_row from public.orders where id = p_order_id for update;

  -- 42501 rather than P0002: PostgREST reports an unrecognised SQLSTATE as
  -- HTTP 500, which reads as a server fault in the UI. 403 also avoids
  -- confirming whether somebody else's order exists.
  if current_row.id is null then
    raise exception 'order not found' using errcode = '42501';
  end if;

  if current_row.status in ('delivered', 'cancelled') then
    raise exception 'order % is % and can no longer change',
      current_row.reference, current_row.status
      using errcode = '22023';
  end if;

  current_rank := case current_row.status
    when 'placed' then 1
    when 'contacted' then 2
    when 'dispatched' then 3
    when 'delivered' then 4
  end;

  target_rank := case p_status
    when 'placed' then 1
    when 'contacted' then 2
    when 'dispatched' then 3
    when 'delivered' then 4
  end;

  if p_status <> 'cancelled' and target_rank <= current_rank then
    raise exception 'order % is already %; it cannot go back to %',
      current_row.reference, current_row.status, p_status
      using errcode = '22023';
  end if;

  update public.orders
     set status            = p_status,
         status_note       = nullif(btrim(coalesce(p_note, '')), ''),
         status_updated_at = now(),
         status_updated_by = auth.uid(),
         contacted_at      = case when p_status = 'contacted' then coalesce(contacted_at, now()) else contacted_at end,
         dispatched_at     = case when p_status = 'dispatched' then coalesce(dispatched_at, now()) else dispatched_at end,
         delivered_at      = case when p_status = 'delivered' then coalesce(delivered_at, now()) else delivered_at end,
         cancel_requested  = case when p_status = 'cancelled' then false else cancel_requested end
   where id = p_order_id
   returning * into updated;

  return updated;
end;
$$;

revoke all on function public.set_order_status(uuid, text, text) from public, anon;
grant execute on function public.set_order_status(uuid, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Same error-code treatment for the customer-facing cancellation request.
-- ---------------------------------------------------------------------------
create or replace function public.request_order_cancellation(p_order_id uuid)
returns public.orders
language plpgsql
security definer
set search_path = public
as $$
declare
  current_row public.orders;
  updated     public.orders;
begin
  if auth.uid() is null then
    raise exception 'sign in to request a cancellation' using errcode = '42501';
  end if;

  select * into current_row
    from public.orders where id = p_order_id for update;

  -- One message for "no such order" and "not your order", so this cannot be
  -- used to discover that somebody else's order reference exists.
  if current_row.id is null or current_row.user_id <> auth.uid() then
    raise exception 'order not found' using errcode = '42501';
  end if;

  if current_row.status in ('dispatched', 'delivered', 'cancelled') then
    raise exception 'order % is already %', current_row.reference, current_row.status
      using errcode = '22023';
  end if;

  if current_row.cancel_requested then
    return current_row;
  end if;

  update public.orders
     set cancel_requested = true
   where id = p_order_id
   returning * into updated;

  return updated;
end;
$$;

revoke all on function public.request_order_cancellation(uuid) from public, anon;
grant execute on function public.request_order_cancellation(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Staff must not appear in the admin staff list as verified unless the
--    database says so. Belt and braces: the admin screen reads
--    email_verified_at, which is now not writable by anyone but the trigger.
-- ---------------------------------------------------------------------------
revoke insert, update, delete on public.profiles from anon, authenticated;

notify pgrst, 'reload schema';

-- ###########################################################################
-- FILE: supabase/migrations/20260101001400_revoke_truncate_and_regrant.sql
-- ###########################################################################
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

-- ###########################################################################
-- FILE: supabase/migrations/20260101001500_restore_dispatch_lockout.sql
-- ###########################################################################
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

-- ###########################################################################
-- FILE: supabase/migrations/20260101001600_atomic_order_placement.sql
-- ###########################################################################
-- ===========================================================================
-- 016 atomic order placement
--
-- Checkout used to be two client round trips: insert `orders`, then insert
-- `order_items`. If the second failed the order still existed, with no lines
-- and a total of zero, and the customer had already been shown a reference as
-- if it were placed.
--
-- This replaces both with a single call. Two things get better at once:
--
--   1. Atomicity. Either the order and all of its lines exist, or nothing
--      does. A partial order is no longer representable.
--
--   2. Price integrity. Line prices are now read from `products` inside the
--      function, not taken from the request. Previously a modified client could
--      post `unit_price: 1` and the recalc trigger would faithfully total it.
--      The request now carries identity (product id, colour, size) and quantity
--      only â€” the money is derived.
--
-- SECURITY INVOKER, not DEFINER. That is the point: the function runs with the
-- caller's privileges, so `orders_owner_insert` and
-- `order_items_insert_via_order` are still what authorise the write, and
-- `auth.uid()` is still the customer. A DEFINER function would have to
-- re-implement both checks by hand, and any slip in that re-implementation
-- would be a privilege escalation.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- Validated before anything is written, so a bad payload fails with a readable
-- message instead of a constraint violation partway through.
--
-- Runs as the caller, so an anonymous request fails on the auth.uid() check
-- rather than on a privilege error.
-- ---------------------------------------------------------------------------
  create or replace function public.place_order(
    p_items          jsonb,
    p_delivery       jsonb  default null,
    p_notes          text   default null,
    p_address_id     uuid   default null,
    p_customer_name  text   default null,
    p_customer_phone text   default null
  )
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  new_order_id   uuid;
  new_reference  text;
  item           jsonb;
  product_row    record;
  item_product_id uuid;
  item_color     text;
  item_size      text;
  item_qty       integer;
  line_count     integer := 0;
  available_units integer;
  -- Accumulated in the loop, so the lines come back in the order the customer
  -- chose them. `order_items` has no sequence column and its ids are random
  -- uuids, so there is nothing to sort by afterwards.
  stored_items   jsonb := '[]'::jsonb;
begin
  -- ---------------------------------------------------------------- session
  if auth.uid() is null then
    raise exception 'you must be signed in to place an order'
      using errcode = '28000';
  end if;

  -- A staff member has no cart, and a suspended or unverified account has no
  -- business ordering.
  if not exists (
    select 1 from public.profiles p
     where p.id = auth.uid()
       and p.role = 'customer'
       and p.status = 'active'
       and p.is_active
       and p.email_verified_at is not null
  ) then
    raise exception 'only a verified, active customer can place an order'
      using errcode = '42501';
  end if;

  -- ---------------------------------------------------------------- payload
  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'items must be a JSON array' using errcode = '22023';
  end if;

  if jsonb_array_length(p_items) = 0 then
    raise exception 'an order needs at least one item' using errcode = '22023';
  end if;

  -- A guard rather than a business rule: this is a clothing store, not a
  -- wholesaler, and an unbounded array is only ever an attack.
  if jsonb_array_length(p_items) > 50 then
    raise exception 'an order cannot contain more than 50 lines' using errcode = '22023';
  end if;

  -- A delivery address is optional, because the storefront lets a customer
  -- check out with nothing saved -- the staff console labels that case
  -- "Pickup at store". Rejecting it here would break a flow that already works
  -- on the two-call path and that the addresses table has no data for.
  --
  -- When an address *is* supplied it has to be complete, so a half-filled
  -- snapshot can never reach the dispatch log.
  if p_delivery is not null and jsonb_typeof(p_delivery) <> 'object' then
    raise exception 'the delivery address is malformed' using errcode = '22023';
  end if;

  if p_delivery is not null and (
       coalesce(btrim(p_delivery ->> 'full_name'), '') = ''
    or coalesce(btrim(p_delivery ->> 'phone'), '') = ''
    or coalesce(btrim(p_delivery ->> 'line1'), '') = ''
    or coalesce(btrim(p_delivery ->> 'city'), '') = ''
    or coalesce(btrim(p_delivery ->> 'pincode'), '') = ''
  ) then
    raise exception 'the delivery address is incomplete'
      using errcode = '22023';
  end if;

  -- ------------------------------------------------------------ order header
  -- `reference` and `user_id` are filled by their own before-insert trigger,
  -- so the request never supplies either.
  --
  -- `customer_name` / `customer_phone` come from the request rather than the
  -- address, because a pickup order has no address and the store still needs
  -- somebody to confirm with. The address snapshot wins when both are present.
  insert into public.orders (
    customer_name,
    customer_phone,
    notes,
    address_id,
    delivery
  )
  values (
    coalesce(
      nullif(btrim(coalesce(p_delivery ->> 'full_name', '')), ''),
      nullif(btrim(coalesce(p_customer_name, '')), ''),
      'Customer'
    ),
    coalesce(
      nullif(btrim(coalesce(p_delivery ->> 'phone', '')), ''),
      nullif(btrim(coalesce(p_customer_phone, '')), ''),
      ''
    ),
    nullif(btrim(coalesce(p_notes, '')), ''),
    p_address_id,
    p_delivery
  )
  returning id, reference into new_order_id, new_reference;

  -- Checked after the insert so the failure is caught inside this transaction
  -- and the order disappears with it. A foreign key alone would happily point
  -- at somebody else's saved address, which staff would then see.
  if p_address_id is not null and not exists (
    select 1 from public.addresses a where a.id = p_address_id and a.user_id = auth.uid()
  ) then
    raise exception 'that address does not belong to you' using errcode = '42501';
  end if;

  -- ------------------------------------------------------------------- lines
  for item in select value from jsonb_array_elements(p_items)
  loop
    -- Validated by pattern before casting. Without the guard a malformed id
    -- raises 22P02 invalid_text_representation, which tells a caller nothing
    -- about what it should send instead.
    if coalesce(item ->> 'product_id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      raise exception 'every line needs a valid product id' using errcode = '22023';
    end if;
    item_product_id := (item ->> 'product_id')::uuid;

    if coalesce(item ->> 'quantity', '') !~ '^[0-9]{1,3}$' then
      raise exception 'every line needs a whole-number quantity' using errcode = '22023';
    end if;
    item_qty := (item ->> 'quantity')::integer;

    if item_qty < 1 or item_qty > 50 then
      raise exception 'quantity must be between 1 and 50' using errcode = '22023';
    end if;

    item_color := nullif(btrim(item ->> 'color'), '');
    item_size  := nullif(btrim(item ->> 'size'), '');

    -- Price, name and availability are read, never accepted. This is what
    -- stops a tampered request naming a cheaper price, an archived product, or
    -- a size that is sold out.
    select p.id,
           p.name,
           p.slug,
           p.sku,
           coalesce(p.images[1], p.image_url) as lead_image,
           p.selling_price,
           p.compare_at_price,
           p.variant_stock
      into product_row
      from public.products p
     where p.id = item_product_id
       and p.is_archived = false
       and p.is_available = true;

    if not found then
      raise exception 'one of the items is no longer available'
        using errcode = '22023';
    end if;

    -- Per-variant stock where the product tracks it. A missing combination
    -- reads as zero, the same rule the storefront uses, so adding a size to a
    -- product does not invent inventory.
    if product_row.variant_stock is not null
       and product_row.variant_stock <> '{}'::jsonb then
      available_units := coalesce(
        (product_row.variant_stock ->> (coalesce(item_color, '') || '|' || coalesce(item_size, '')))::integer,
        0
      );

      if available_units < item_qty then
        raise exception '% (% / %) has only % left',
          product_row.name,
          coalesce(item_color, 'any colour'),
          coalesce(item_size, 'any size'),
          available_units
          using errcode = '22023';
      end if;
    end if;

    insert into public.order_items (
      order_id, product_id, name, slug, sku, image, color, size,
      unit_price, compare_at_price, quantity, line_total
    )
    values (
      new_order_id,
      item_product_id,
      product_row.name,
      product_row.slug,
      product_row.sku,
      product_row.lead_image,
      item_color,
      item_size,
      product_row.selling_price,
      product_row.compare_at_price,
      item_qty,
      round(product_row.selling_price * item_qty, 2)
    );

    line_count := line_count + 1;

    stored_items := stored_items || jsonb_build_object(
      'product_id', item_product_id,
      'name', product_row.name,
      'slug', product_row.slug,
      'sku', product_row.sku,
      'image', product_row.lead_image,
      'color', item_color,
      'size', item_size,
      'unit_price', product_row.selling_price,
      'compare_at_price', product_row.compare_at_price,
      'quantity', item_qty,
      'line_total', round(product_row.selling_price * item_qty, 2)
    );
  end loop;

  if line_count = 0 then
    raise exception 'an order needs at least one item' using errcode = '22023';
  end if;

  -- `order_items_recalc_order` is SECURITY DEFINER and has already rewritten
  -- the money columns. Read them back so the checkout screen shows the figures
  -- the database holds, not the ones the client believed it sent.
  --
  -- The lines come back too. The WhatsApp message is built from these rather
  -- than from the cart, so if a price changed while the customer was filling
  -- in the form, the message the store receives matches the order that was
  -- actually stored.
  return jsonb_build_object(
    'id', new_order_id,
    'reference', new_reference,
    'item_count', (select o.item_count from public.orders o where o.id = new_order_id),
    'subtotal', (select o.subtotal from public.orders o where o.id = new_order_id),
    'savings', (select o.savings from public.orders o where o.id = new_order_id),
    'total', (select o.total from public.orders o where o.id = new_order_id),
    'items', stored_items
  );
end;
$$;

comment on function public.place_order(jsonb, jsonb, text, uuid, text, text) is
  'Places an order and all of its lines in one transaction. Prices are read '
  'from the catalogue, never taken from the request. Runs as the caller, so '
  'the existing RLS policies are what authorise the write.';

-- `authenticated` only. An anonymous caller must not reach the function at
-- all, even though the invoker body would reject it anyway.
revoke all on function public.place_order(jsonb, jsonb, text, uuid, text, text) from public, anon;
grant execute on function public.place_order(jsonb, jsonb, text, uuid, text, text) to authenticated;

notify pgrst, 'reload schema';

-- ###########################################################################
-- FILE: supabase/migrations/20260101001700_single_order_writer.sql
-- ###########################################################################
-- ===========================================================================
-- Kaal Vastr — 017 one writer for orders
--
-- 016 built `place_order` so that prices are read from the catalogue instead of
-- being taken from the request, and made the order and its lines one
-- transaction. It deliberately left the function SECURITY INVOKER, on the
-- reasoning that the RLS insert policies were what authorised the write.
--
-- That reasoning holds the function to a standard the rest of the schema did
-- not meet: `authenticated` still held a blanket INSERT grant on `orders` and
-- `order_items` (015 kept it so the pre-016 two-call checkout could still
-- finish). With those grants in place the policies authorise far more than the
-- function does, and everything 016 was built to guarantee became advisory.
--
-- A signed-in customer holding nothing but the public anon key could post
-- straight to /rest/v1/orders and /rest/v1/order_items, skipping the function
-- entirely. Because `order_items_recalc_order` sums `order_items.unit_price`,
-- and that column is client-supplied on insert, the trigger faithfully totalled
-- whatever the caller asked for. Reproduced on a clean database:
--
--     insert into orders    (reference, item_count, subtotal, total, ...)  -- declared
--     insert into order_items (unit_price, quantity, ...)                 -- priced
--
--     reference    | status | item_count | subtotal | savings  | total
--     --------------+--------+------------+----------+----------+-------
--     KV-ATTACK-0001| placed |         40 |     0.00 | 399960.00 | 0.00
--
-- Forty hoodies at a real Rs 4,499, totalling zero, sitting in the staff
-- dispatch log to be confirmed over WhatsApp. The same grants were also why
-- the fallback checkout path existed in the client at all.
--
-- The fix is to stop having two writers:
--
--   1. `place_order` becomes SECURITY DEFINER. It already re-checks the
--      caller's role, active/verified status, address ownership, product
--      visibility and per-variant stock by hand, and it never accepts
--      `user_id`, `reference`, `unit_price` or any total as input, so it does
--      not depend on the caller's grants or on RLS to be correct.
--   2. Nobody holds INSERT on `orders` or `order_items` any more, and the two
--      insert policies that existed only to serve the two-call path are
--      dropped so a future blanket re-grant cannot silently reopen this.
--
-- SELECT is untouched, so every read path and every policy below is unchanged.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- The function becomes the only writer. `set search_path = public` is already
-- declared on it, which is what keeps a definer function from being hijacked
-- through a temporary schema earlier in the path.
--
-- auth.uid() reads a session GUC, not a privilege, so it still resolves to the
-- customer rather than to this function's owner.
-- ---------------------------------------------------------------------------
create or replace function public.place_order(
  p_items          jsonb,
  p_delivery       jsonb  default null,
  p_notes          text   default null,
  p_address_id     uuid   default null,
  p_customer_name  text   default null,
  p_customer_phone text   default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  new_order_id    uuid;
  new_reference   text;
  item            jsonb;
  product_row     record;
  item_product_id uuid;
  item_color      text;
  item_size       text;
  item_qty        integer;
  line_count      integer := 0;
  available_units integer;
  stored_items    jsonb := '[]'::jsonb;
begin
  -- ---------------------------------------------------------------- session
  if auth.uid() is null then
    raise exception 'you must be signed in to place an order'
      using errcode = '28000';
  end if;

  -- Runs as the owner now, so this is the only thing standing between an
  -- authenticated session and the orders table. It must not be loosened.
  if not exists (
    select 1 from public.profiles p
     where p.id = auth.uid()
       and p.role = 'customer'
       and p.status = 'active'
       and p.is_active
       and p.email_verified_at is not null
  ) then
    raise exception 'only a verified, active customer can place an order'
      using errcode = '42501';
  end if;

  -- ---------------------------------------------------------------- payload
  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'items must be a JSON array' using errcode = '22023';
  end if;

  if jsonb_array_length(p_items) = 0 then
    raise exception 'an order needs at least one item' using errcode = '22023';
  end if;

  -- A guard rather than a business rule: this is a clothing store, not a
  -- wholesaler, and an unbounded array is only ever an attack.
  if jsonb_array_length(p_items) > 50 then
    raise exception 'an order cannot contain more than 50 lines' using errcode = '22023';
  end if;

  -- A delivery address is optional, because the storefront lets a customer
  -- check out with nothing saved -- the staff console labels that case
  -- "Pickup at store". When one *is* supplied it has to be complete, so a
  -- half-filled snapshot can never reach the dispatch log.
  if p_delivery is not null and jsonb_typeof(p_delivery) <> 'object' then
    raise exception 'the delivery address is malformed' using errcode = '22023';
  end if;

  if p_delivery is not null and (
       coalesce(btrim(p_delivery ->> 'full_name'), '') = ''
    or coalesce(btrim(p_delivery ->> 'phone'), '') = ''
    or coalesce(btrim(p_delivery ->> 'line1'), '') = ''
    or coalesce(btrim(p_delivery ->> 'city'), '') = ''
    or coalesce(btrim(p_delivery ->> 'pincode'), '') = ''
  ) then
    raise exception 'the delivery address is incomplete'
      using errcode = '22023';
  end if;

  -- Checked before the header is written. A foreign key alone would happily
  -- point at somebody else's saved address, which staff would then see.
  if p_address_id is not null and not exists (
    select 1 from public.addresses a where a.id = p_address_id and a.user_id = auth.uid()
  ) then
    raise exception 'that address does not belong to you' using errcode = '42501';
  end if;

  -- ------------------------------------------------------------ order header
  -- `reference` and `user_id` are filled by their own before-insert trigger,
  -- so the request never supplies either. With RLS bypassed under this
  -- function, that trigger is the only thing setting the owner.
  insert into public.orders (
    customer_name,
    customer_phone,
    notes,
    address_id,
    delivery
  )
  values (
    coalesce(
      nullif(btrim(coalesce(p_delivery ->> 'full_name', '')), ''),
      nullif(btrim(coalesce(p_customer_name, '')), ''),
      'Customer'
    ),
    coalesce(
      nullif(btrim(coalesce(p_delivery ->> 'phone', '')), ''),
      nullif(btrim(coalesce(p_customer_phone, '')), ''),
      ''
    ),
    nullif(btrim(coalesce(p_notes, '')), ''),
    p_address_id,
    p_delivery
  )
  returning id, reference into new_order_id, new_reference;

  -- ------------------------------------------------------------------- lines
  for item in select value from jsonb_array_elements(p_items)
  loop
    -- Validated by pattern before casting. Without the guard a malformed id
    -- raises 22P02 invalid_text_representation, which tells a caller nothing
    -- about what it should send instead.
    if coalesce(item ->> 'product_id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      raise exception 'every line needs a valid product id' using errcode = '22023';
    end if;
    item_product_id := (item ->> 'product_id')::uuid;

    if coalesce(item ->> 'quantity', '') !~ '^[0-9]{1,3}$' then
      raise exception 'every line needs a whole-number quantity' using errcode = '22023';
    end if;
    item_qty := (item ->> 'quantity')::integer;

    if item_qty < 1 or item_qty > 50 then
      raise exception 'quantity must be between 1 and 50' using errcode = '22023';
    end if;

    item_color := nullif(btrim(item ->> 'color'), '');
    item_size  := nullif(btrim(item ->> 'size'), '');

    -- Price, name and availability are read, never accepted. This is what
    -- stops a tampered request naming a cheaper price, an archived product, or
    -- a size that is sold out. The product read also bypasses RLS now, so the
    -- archived/available filter here is the only visibility rule that applies.
    select p.id,
           p.name,
           p.slug,
           p.sku,
           coalesce(p.images[1], p.image_url) as lead_image,
           p.selling_price,
           p.compare_at_price,
           p.variant_stock
      into product_row
      from public.products p
     where p.id = item_product_id
       and p.is_archived = false
       and p.is_available = true;

    if not found then
      raise exception 'one of the items is no longer available'
        using errcode = '22023';
    end if;

    -- Per-variant stock where the product tracks it. A missing combination
    -- reads as zero, the same rule the storefront uses, so adding a size to a
    -- product does not invent inventory.
    if product_row.variant_stock is not null
       and product_row.variant_stock <> '{}'::jsonb then
      available_units := coalesce(
        (product_row.variant_stock ->> (coalesce(item_color, '') || '|' || coalesce(item_size, '')))::integer,
        0
      );

      if available_units < item_qty then
        raise exception '% (% / %) has only % left',
          product_row.name,
          coalesce(item_color, 'any colour'),
          coalesce(item_size, 'any size'),
          available_units
          using errcode = '22023';
      end if;
    end if;

    insert into public.order_items (
      order_id, product_id, name, slug, sku, image, color, size,
      unit_price, compare_at_price, quantity, line_total
    )
    values (
      new_order_id,
      item_product_id,
      product_row.name,
      product_row.slug,
      product_row.sku,
      product_row.lead_image,
      item_color,
      item_size,
      product_row.selling_price,
      product_row.compare_at_price,
      item_qty,
      round(product_row.selling_price * item_qty, 2)
    );

    line_count := line_count + 1;

    stored_items := stored_items || jsonb_build_object(
      'product_id', item_product_id,
      'name', product_row.name,
      'slug', product_row.slug,
      'sku', product_row.sku,
      'image', product_row.lead_image,
      'color', item_color,
      'size', item_size,
      'unit_price', product_row.selling_price,
      'compare_at_price', product_row.compare_at_price,
      'quantity', item_qty,
      'line_total', round(product_row.selling_price * item_qty, 2)
    );
  end loop;

  if line_count = 0 then
    raise exception 'an order needs at least one item' using errcode = '22023';
  end if;

  -- `order_items_recalc_order` is SECURITY DEFINER and has already rewritten
  -- the money columns. Read them back so the checkout screen shows the figures
  -- the database holds, not the ones the client believed it sent.
  --
  -- The lines come back too. The WhatsApp message is built from these rather
  -- than from the cart, so if a price changed while the customer was filling
  -- in the form, the message the store receives matches the order that was
  -- actually stored.
  return jsonb_build_object(
    'id', new_order_id,
    'reference', new_reference,
    'item_count', (select o.item_count from public.orders o where o.id = new_order_id),
    'subtotal', (select o.subtotal from public.orders o where o.id = new_order_id),
    'savings', (select o.savings from public.orders o where o.id = new_order_id),
    'total', (select o.total from public.orders o where o.id = new_order_id),
    'items', stored_items
  );
end;
$$;

comment on function public.place_order(jsonb, jsonb, text, uuid, text, text) is
  'The only writer of orders and order_items. SECURITY DEFINER: it re-checks '
  'the caller''s role, active and verified status, address ownership, product '
  'visibility and per-variant stock itself, and takes no price, total, owner '
  'or reference from the request.';

-- Re-issued because CREATE OR REPLACE keeps the existing privileges, and the
-- function body is what now carries the authorisation.
revoke all on function public.place_order(jsonb, jsonb, text, uuid, text, text) from public, anon;
grant execute on function public.place_order(jsonb, jsonb, text, uuid, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Close the raw path. Before 017 both tables carried a blanket INSERT for
-- `authenticated`, which is the grant that made the attack above possible.
--
-- UPDATE and DELETE stay revoked as 015 left them: order status has exactly one
-- writer, `set_order_status`, and nobody rewrites a price after the fact.
-- ---------------------------------------------------------------------------
revoke insert, update, delete on public.orders from anon, authenticated;
revoke insert, update, delete on public.order_items from anon, authenticated;

-- The insert policies existed for the two-call checkout. With no INSERT grant
-- behind them they are inert, and an inert policy is a footgun: re-granting
-- INSERT later would silently reopen the hole these were meant to close.
drop policy if exists "orders_owner_insert" on public.orders;
drop policy if exists "order_items_insert_via_order" on public.order_items;

-- `order_items_admin_mutate` is the same story. It was a correction path for
-- admin, but the admin UI only ever reads order lines, so it authorises
-- nothing that is used and would permit a privileged account to post an
-- arbitrary unit_price. The admin keeps full read access through
-- `order_items_read_via_order`, which already admits `is_admin()`.
drop policy if exists "order_items_admin_mutate" on public.order_items;

-- Addresses stay fully customer-owned: a customer must be able to add, correct
-- and delete their own saved address without a round trip through checkout.
grant select, insert, update, delete on public.addresses to authenticated;

notify pgrst, 'reload schema';

-- ###########################################################################
-- END: 17 migrations applied in order.
--
-- Sanity check — should return one row per line:
--   select status, count(*) from public.orders group by status;
--   select role, count(*) from public.profiles group by role;
--   select proname from pg_proc
--    where proname in ('set_order_status','request_order_cancellation',
--                      'set_account_role','can_use_staff_console');
-- ###########################################################################
