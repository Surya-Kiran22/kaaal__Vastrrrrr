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
