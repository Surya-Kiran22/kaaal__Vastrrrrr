-- Minimal stand-in for the schemas that Supabase owns, so the migrations and the
-- checkout test can run on a plain PostgreSQL server.
--
-- This exists because `auth` and `storage` belong to the Supabase platform and
-- are not part of any migration in this repository. Without them the bundle
-- fails at the first statement that touches `auth.users`, which makes the
-- security regression test in `place_order.sql` impossible to run anywhere except
-- a real project. Nothing here is a reimplementation of Supabase: it is just
-- enough surface for the migrations to apply and for row level security to be
-- exercised for real.
--
-- Only use this against a throwaway database. Never apply it to a live project:
-- it creates an `auth.users` table that is not the real one.

\echo 'Creating the Supabase-owned schemas, roles and auth helpers...'

create schema if not exists auth;
create schema if not exists storage;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    -- Matches the real platform: this role bypasses row level security, so
    -- nothing in the test may ever assume it is subject to the policies.
    create role service_role nologin bypassrls;
  end if;
end
$$;

grant usage on schema auth, storage to anon, authenticated;

-- The columns the migrations and the tests actually read. `raw_user_meta_data`
-- is what `handle_new_user` inspects, so it has to exist for the signup path to
-- be testable at all.
create table if not exists auth.users (
  id                 uuid primary key,
  email              text unique,
  phone              text,
  email_confirmed_at timestamptz,
  raw_user_meta_data jsonb not null default '{}'::jsonb,
  created_at         timestamptz not null default now()
);

comment on table auth.users is
  'Test stand-in only. The real table is owned by Supabase and has more columns.';

-- The platform provides `auth.uid()` and every row level security policy in
-- this repository calls it. It reads the same claim key the real one does, which
-- is why the tests can impersonate a role by setting that GUC.
create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;

create table if not exists storage.buckets (
  id                 text primary key,
  name               text not null,
  public            boolean not null default false,
  file_size_limit    bigint,
  allowed_mime_types text[],
  created_at         timestamptz not null default now()
);

create table if not exists storage.objects (
  id         uuid primary key default gen_random_uuid(),
  bucket_id  text references storage.buckets (id),
  name       text,
  owner      uuid,
  created_at timestamptz not null default now()
);

alter table storage.objects enable row level security;
alter table storage.buckets enable row level security;

\echo 'Supabase-owned schemas stubbed. Now apply supabase/apply-all.sql.'
