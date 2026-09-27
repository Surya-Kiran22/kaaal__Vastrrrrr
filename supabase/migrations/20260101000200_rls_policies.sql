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
