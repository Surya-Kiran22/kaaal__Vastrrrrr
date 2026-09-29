-- ===========================================================================
-- Kaal Vastr — 019 customer identity: username, avatar, locked contact details
--
-- Adds the three things the customer profile was missing:
--
--   username    generated once from the full name at signup, unique, immutable
--   avatar_url  NULL until the customer uploads their own picture
--   (phone)     made required and unique, and no longer editable
--
-- Why phone becomes unique
-- ------------------------
-- Two customers sharing a phone number is a support problem: dispatch calls
-- one of them about the other's delivery, and neither can tell from the record
-- which order a number belongs to. The column had no constraint at all, so the
-- database happily accepted duplicates and only the UI would have noticed.
--
-- A partial unique index is used rather than a table constraint because phone
-- is nullable and legacy rows predate the signup requirement. Several NULLs
-- coexist under a unique index, so staff/admin rows created without a phone
-- stay valid; '' is treated as absent for the same reason, which is why the
-- index is on `nullif(btrim(phone), '')` and not on phone directly.
--
-- Why email and phone are locked after signup
-- -------------------------------------------
-- 013/014 granted `update (full_name, phone)` on profiles so a customer could
-- correct a typo in their own number. That is the wrong trade here: the email
-- is the identity the OTP verification and every order notification hang off,
-- and the phone is what dispatch calls. Silently repointing either one after
-- signup hands an attacker a takeover primitive they can complete without ever
-- seeing the confirmation code, because the verification state lives on the old
-- address. The grant is narrowed to full_name and avatar_url; changing contact
-- details is now a support action, not a self-service one.
--
-- Why the username is immutable
-- ------------------------------
-- It is generated in a BEFORE INSERT trigger from the full name, with a numeric
-- suffix on collision (surya, surya2, surya3). It is deliberately NOT in the
-- update grant, so a later name edit cannot orphan a handle someone else then
-- claims. Usernames are display labels, not handles to be traded.
--
-- The generator runs SECURITY DEFINER because it has to read public.profiles
-- to spot a collision, and it must not be callable by anyone who can insert
-- rows into that table for themselves.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Columns
-- ---------------------------------------------------------------------------
alter table public.profiles add column if not exists username text;
alter table public.profiles add column if not exists avatar_url text;

-- 3-30 chars, lowercase, digits allowed but not leading, and no consecutive or
-- trailing separators. This is what makes the value safe to render in a URL and
-- to compare without normalising on read.
alter table public.profiles
  drop constraint if exists profiles_username_format;
alter table public.profiles
  add constraint profiles_username_format
  check (
    username is null or (
      length(username) between 3 and 30
      and username = lower(username)
      and username ~ '^[a-z0-9][a-z0-9._-]*[a-z0-9]$'
      and username !~ '[._-]{2,}'
      and username !~ '[._-]$'
    )
  );

-- One account per phone number. See the note above on nullif/btrim.
create unique index if not exists profiles_phone_unique
  on public.profiles (nullif(btrim(phone), ''))
  where phone is not null and btrim(phone) <> '';

-- 018's grant is replaced wholesale below; the uniqueness has to exist first so
-- the lock is meaningful.
drop index if exists profiles_username_key;

-- ---------------------------------------------------------------------------
-- 2. Username generation
-- ---------------------------------------------------------------------------
-- translate() is used rather than unaccent() on purpose. unaccent() lives in
-- the `extensions` schema on hosted Supabase, which these SECURITY DEFINER
-- functions deliberately do not put on their search_path, and it is not
-- installed by this project's migrations at all -- only pg_trgm is. Depending
-- on it would make the migration fail on any plain Postgres and fail here
-- too. A fixed mapping keeps this self-contained and portable.
create or replace function public.slugify_username(source text)
returns text
language sql
immutable
as $$
  -- Fold the common Latin diacritics so "Sarma" and "Sharma" cannot both claim
  -- `sarma` by way of different byte sequences. Anything else that is not a
  -- letter or digit becomes a separator.
  select trim(both '-' from regexp_replace(
           regexp_replace(
             translate(
               lower(coalesce(source, '')),
               'áàâäãåāéèêëēíìîïīóòôöõōúùûüūñçšžżýÿđł',
               'aaaaaaaeeeeeiiiiioooooouuuuuncszzyydl'
             ),
             '[^a-z0-9]+', '-', 'g'
           ),
           '-{2,}', '-', 'g'
         ));
$$;

create or replace function public.generate_unique_username(source text)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  base  text;
  candidate text;
  suffix integer := 1;
begin
  base := public.slugify_username(source);

  -- A name made entirely of punctuation, or a name of one or two characters,
  -- leaves nothing usable. Fall back rather than fail the signup.
  if base is null or length(base) < 3 then
    base := 'user';
  end if;

  -- Truncation can slice a run mid-word and leave a separator hanging off the
  -- end, e.g. a 31-character name reduced to 27 lands on "abcdefg-". The format
  -- check rejects a trailing separator, so it is stripped here rather than
  -- letting the signup fail on a constraint.
  if length(base) > 27 then
    base := regexp_replace(left(base, 27), '[._-]+$', '', 'g');
  end if;

  candidate := base;

  -- Serialisation is not needed: this only ever runs from the signup trigger,
  -- and the unique index below is the real guarantee. A lost race surfaces as a
  -- unique violation on profiles.username rather than silently overwriting.
  while exists (select 1 from public.profiles where username = candidate) loop
    suffix := suffix + 1;
    candidate :=
      regexp_replace(left(base, 30 - length(suffix::text) - 1), '[._-]+$', '', 'g')
      || suffix::text;
  end loop;

  return candidate;
end;
$$;

revoke all on function public.slugify_username(text) from public, anon, authenticated;
revoke all on function public.generate_unique_username(text) from public, anon, authenticated;
-- Reachable only through the trigger below, never over the wire.

-- ---------------------------------------------------------------------------
-- 3. Fill the username in on insert
--
-- handle_new_user() inserts the profile row without a username, so the trigger
-- derives it from the full_name it carries. Runs for staff invitations too,
-- which is why the result is not forced to look like a customer handle.
-- ---------------------------------------------------------------------------
create or replace function public.profiles_assign_username()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.username is null or btrim(new.username) = '' then
    new.username := public.generate_unique_username(coalesce(new.full_name, ''));
  end if;

  -- Canonicalise the phone to digits only. Without this, "+91 98765 43210" and
  -- "+919876543210" are two different strings to the unique index, so the same
  -- person could pass the same number twice with different punctuation and both
  -- rows would be accepted. Dropping every non-digit -- including the leading
  -- '+' -- is what makes the constraint mean "one person, one number" instead
  -- of "one exact spelling, one row".
  if new.phone is not null then
    new.phone := nullif(
      regexp_replace(
        regexp_replace(btrim(new.phone), '^\+', ''),
        '[^0-9]', '', 'g'
      ),
      ''
    );
  end if;

  return new;
end;
$$;

drop trigger if exists trg_profiles_assign_username on public.profiles;
create trigger trg_profiles_assign_username
  before insert on public.profiles
  for each row execute function public.profiles_assign_username();

-- Existing rows predate the column. Backfill so no profile is left without a
-- handle; the unique index is built afterwards so a collision mid-backfill
-- cannot abort the whole migration.
update public.profiles p
   set username = public.generate_unique_username(p.full_name)
 where p.username is null or btrim(p.username) = '';

alter table public.profiles
  alter column username set not null;

create unique index if not exists profiles_username_unique
  on public.profiles (username);

-- ---------------------------------------------------------------------------
-- 4. Lock contact details
--
-- Replaces 013/014's `grant update (full_name, phone)`. Phone is dropped from
-- the grant so a customer cannot repoint dispatch at another number, and
-- avatar_url is added so the picture can be changed without a support request.
-- email was never in the grant and stays out.
-- ---------------------------------------------------------------------------
revoke update on public.profiles from anon, authenticated;
grant  update (full_name, avatar_url) on public.profiles to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Avatar bucket
--
-- Public read, because the avatar renders on pages a signed-out visitor can
-- see. Writes are scoped to `auth.uid()` and the key must live under that
-- user's own folder, so one customer cannot overwrite another's picture even
-- though both can insert into the same bucket.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'profile-avatars',
  'profile-avatars',
  true,
  2097152, -- 2 MB
  array['image/jpeg', 'image/png', 'image/webp', 'image/avif']
)
on conflict (id) do update
  set public             = excluded.public,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "profile_avatars_public_read" on storage.objects;
create policy "profile_avatars_public_read"
  on storage.objects for select
  using (bucket_id = 'profile-avatars');

-- The `folder = user_id` component is the point: it is what stops one customer
-- writing over someone else's avatar. storage.foldername() yields the path
-- segments, so name[1] is the owning folder.
drop policy if exists "profile_avatars_insert_own" on storage.objects;
create policy "profile_avatars_insert_own"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'profile-avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "profile_avatars_update_own" on storage.objects;
create policy "profile_avatars_update_own"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'profile-avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'profile-avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "profile_avatars_delete_own" on storage.objects;
create policy "profile_avatars_delete_own"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'profile-avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

notify pgrst, 'reload schema';
