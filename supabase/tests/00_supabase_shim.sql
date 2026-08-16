-- ============================================================================
-- Test-only shim.
--
-- This file is NEVER run against your real Supabase project. It recreates just
-- enough of Supabase's managed environment (the `auth` schema, the `anon` /
-- `authenticated` roles, the realtime publication) that the real migration can be
-- executed against a stock Postgres container and its RLS policies exercised.
--
-- See supabase/tests/README.md.
-- ============================================================================

create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;

grant usage on schema public to anon, authenticated, service_role;

create schema if not exists auth;
grant usage on schema auth to anon, authenticated, service_role;

-- Stand-in for Supabase's auth.users table (only the columns our trigger reads).
create table auth.users (
  id                   uuid primary key default gen_random_uuid(),
  email                text unique,
  raw_user_meta_data   jsonb not null default '{}'::jsonb,
  created_at           timestamptz not null default now()
);

-- Supabase's auth.uid() reads the `sub` claim off the request-scoped JWT claims
-- GUC. Tests impersonate a user by setting that GUC, exactly like PostgREST does.
create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(
    current_setting('request.jwt.claims', true)::jsonb ->> 'sub',
    ''
  )::uuid;
$$;

grant execute on function auth.uid() to anon, authenticated, service_role;

-- The migration adds tables to this publication.
create publication supabase_realtime;
