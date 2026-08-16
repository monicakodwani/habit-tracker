-- ============================================================================
-- RLS test suite.
--
-- Runs against a throwaway Postgres container that has had 00_supabase_shim.sql
-- and then the real migration applied. Each check impersonates a user exactly the
-- way PostgREST does — `set role authenticated` plus a `request.jwt.claims` GUC
-- carrying their id — so these exercise the same code path a real browser request
-- takes.
--
--   npm run test:rls
--
-- Any failed assertion aborts the script with a non-zero exit code.
-- ============================================================================

\set ON_ERROR_STOP on

create or replace function assert_eq(actual anyelement, expected anyelement, label text)
returns void language plpgsql as $$
begin
  if actual is distinct from expected then
    raise exception 'FAIL: % — expected %, got %', label, expected, actual;
  end if;
  raise notice 'ok: %', label;
end;
$$;

-- Asserts that `stmt` fails, and that its error message matches `expect_pattern`.
create or replace function assert_raises(stmt text, expect_pattern text, label text)
returns void language plpgsql as $$
declare
  msg text;
begin
  begin
    execute stmt;
  exception when others then
    msg := SQLERRM;
    if msg !~* expect_pattern then
      raise exception 'FAIL: % — error did not match %: %', label, expect_pattern, msg;
    end if;
    raise notice 'ok: % (%)', label, left(msg, 60);
    return;
  end;
  raise exception 'FAIL: % — statement unexpectedly succeeded', label;
end;
$$;

-- Impersonate a user for subsequent statements.
create or replace function act_as(user_id uuid)
returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', user_id)::text, false);
end;
$$;

-- ----------------------------------------------------------------------------
-- Fixtures (created as superuser, bypassing RLS)
-- ----------------------------------------------------------------------------

-- Group "Friends": Monica, Ura, Ojas.  Group "Elsewhere": Zed, an unrelated
-- but fully authenticated account, used to prove cross-group isolation.
insert into auth.users (id, email, raw_user_meta_data) values
  ('11111111-1111-1111-1111-111111111111', 'monica@example.test', '{"display_name":"Monica","avatar_emoji":"🌻"}'),
  ('22222222-2222-2222-2222-222222222222', 'ura@example.test',  '{"display_name":"Ura","avatar_emoji":"🦆"}'),
  ('33333333-3333-3333-3333-333333333333', 'ojas@example.test', '{"display_name":"Ojas","avatar_emoji":"🪿"}'),
  ('99999999-9999-9999-9999-999999999999', 'zed@example.test',    '{"display_name":"Zed"}');

-- The on_auth_user_created trigger should have made all four profiles.
select assert_eq((select count(*)::int from public.profiles), 4, 'auth trigger creates a profile per user');
select assert_eq((select display_name from public.profiles where id = '11111111-1111-1111-1111-111111111111'), 'Monica', 'display_name comes from user metadata');
select assert_eq((select display_name from public.profiles where id = '99999999-9999-9999-9999-999999999999'), 'Zed', 'display_name falls back sensibly');

insert into public.groups (id, name) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Friends'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'Elsewhere');

insert into public.group_members (group_id, user_id) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111'),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '22222222-2222-2222-2222-222222222222'),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '33333333-3333-3333-3333-333333333333'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '99999999-9999-9999-9999-999999999999');

insert into public.habits (id, owner_id, group_id, name, emoji, recurrence_type, scheduled_days, visibility) values
  ('c1111111-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Vitamins', '💊', 'scheduled_days', '{1,2,3,4,5,6,7}', 'shared'),
  ('c1111111-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Therapy',  '🛋️', 'scheduled_days', '{3}',             'private'),
  ('c2222222-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Yoga',     '🧘', 'scheduled_days', '{1,2,3,4,5}',     'shared');

insert into public.habits (id, owner_id, group_id, name, emoji, recurrence_type, weekly_target, visibility) values
  ('c1111111-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Walk', '🚶', 'weekly_target', 4, 'shared');

insert into public.habit_checkins (habit_id, user_id, completion_date) values
  ('c1111111-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', '2026-08-12'), -- Monica, shared
  ('c1111111-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', '2026-08-12'), -- Monica, PRIVATE
  ('c2222222-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', '2026-08-12'); -- Ura, shared

-- ----------------------------------------------------------------------------
-- Schema-level guarantees (checked as superuser: these are constraints, not policies)
-- ----------------------------------------------------------------------------

select assert_raises(
  $$insert into public.habit_checkins (habit_id, user_id, completion_date)
    values ('c1111111-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', '2026-08-12')$$,
  'habit_checkins_one_per_day|duplicate key',
  'at most one check-in per habit per local day');

-- The composite FK makes cross-user check-ins structurally impossible, even for a
-- superuser / service-role client that bypasses every policy.
select assert_raises(
  $$insert into public.habit_checkins (habit_id, user_id, completion_date)
    values ('c1111111-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', '2026-08-13')$$,
  'habit_checkins_habit_owner_fkey|foreign key',
  'a check-in cannot be attributed to a non-owner');

select assert_raises(
  $$insert into public.habits (owner_id, group_id, name, recurrence_type, scheduled_days)
    values ('11111111-1111-1111-1111-111111111111', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Bad', 'scheduled_days', '{5,1}')$$,
  'habits_recurrence_shape',
  'scheduled_days must be sorted ascending');

select assert_raises(
  $$insert into public.habits (owner_id, group_id, name, recurrence_type, scheduled_days)
    values ('11111111-1111-1111-1111-111111111111', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Bad', 'scheduled_days', '{1,1}')$$,
  'habits_recurrence_shape',
  'scheduled_days must not contain duplicates');

select assert_raises(
  $$insert into public.habits (owner_id, group_id, name, recurrence_type, scheduled_days)
    values ('11111111-1111-1111-1111-111111111111', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Bad', 'scheduled_days', '{0,3}')$$,
  'habits_recurrence_shape',
  'scheduled_days rejects weekday 0 (convention is 1=Mon..7=Sun)');

select assert_raises(
  $$insert into public.habits (owner_id, group_id, name, recurrence_type, scheduled_days)
    values ('11111111-1111-1111-1111-111111111111', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Bad', 'scheduled_days', '{1,8}')$$,
  'habits_recurrence_shape',
  'scheduled_days rejects weekday 8');

select assert_raises(
  $$insert into public.habits (owner_id, group_id, name, recurrence_type, weekly_target, scheduled_days)
    values ('11111111-1111-1111-1111-111111111111', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Bad', 'weekly_target', 3, '{1,2}')$$,
  'habits_recurrence_shape',
  'a weekly_target habit cannot also carry scheduled_days');

select assert_raises(
  $$insert into public.habits (owner_id, group_id, name, recurrence_type, weekly_target)
    values ('11111111-1111-1111-1111-111111111111', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Bad', 'weekly_target', 0)$$,
  'habits_recurrence_shape',
  'weekly_target must be at least 1');

select assert_raises(
  $$insert into public.habits (owner_id, group_id, name, recurrence_type)
    values ('11111111-1111-1111-1111-111111111111', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Bad', 'scheduled_days')$$,
  'habits_recurrence_shape',
  'a scheduled_days habit must carry scheduled_days');

-- ----------------------------------------------------------------------------
-- Monica (owner) — sees her own habits regardless of visibility
-- ----------------------------------------------------------------------------

set role authenticated;
select act_as('11111111-1111-1111-1111-111111111111');

select assert_eq((select count(*)::int from public.habits), 4, 'Monica sees her 3 habits + Ura''s shared one');
select assert_eq((select count(*)::int from public.habits where name = 'Therapy'), 1, 'Monica sees her own private habit');
select assert_eq((select count(*)::int from public.profiles), 3, 'Monica sees exactly her 3 group members');
select assert_eq((select count(*)::int from public.groups), 1, 'Monica sees only her own group');
select assert_eq((select count(*)::int from public.group_members), 3, 'Monica sees her group''s memberships only');
select assert_eq((select count(*)::int from public.habit_checkins), 3, 'Monica sees her own check-ins plus shared ones');

-- ----------------------------------------------------------------------------
-- Ura (friend) — the privacy boundary
-- ----------------------------------------------------------------------------

select act_as('22222222-2222-2222-2222-222222222222');

select assert_eq((select count(*)::int from public.habits where name = 'Therapy'), 0,
  'a friend CANNOT see a private habit');
select assert_eq((select count(*)::int from public.habits), 3,
  'Ura sees her own habit + Monica''s 2 shared habits, and nothing private');
select assert_eq((select count(*)::int from public.habit_checkins), 2,
  'a friend CANNOT see check-ins belonging to a private habit');
select assert_eq(
  (select count(*)::int from public.habit_checkins
   where habit_id = 'c1111111-0000-0000-0000-000000000002'), 0,
  'the private habit''s check-ins are unreachable even by explicit id');
select assert_eq(
  (select count(*)::int from public.habits where id = 'c1111111-0000-0000-0000-000000000002'), 0,
  'the private habit is unreachable even by explicit id');

-- Read-only on a friend's data: these must affect zero rows rather than erroring,
-- because RLS filters the USING clause before the write is attempted.
update public.habits set name = 'Hijacked' where id = 'c1111111-0000-0000-0000-000000000001';
select assert_eq((select count(*)::int from public.habits where name = 'Hijacked'), 0,
  'a friend cannot rename someone else''s habit');

delete from public.habits where id = 'c1111111-0000-0000-0000-000000000001';
select assert_eq((select count(*)::int from public.habits where id = 'c1111111-0000-0000-0000-000000000001'), 1,
  'a friend cannot delete someone else''s habit');

delete from public.habit_checkins where habit_id = 'c1111111-0000-0000-0000-000000000001';
select assert_eq((select count(*)::int from public.habit_checkins where habit_id = 'c1111111-0000-0000-0000-000000000001'), 1,
  'a friend cannot delete someone else''s check-in');

update public.profiles set display_name = 'Hijacked' where id = '11111111-1111-1111-1111-111111111111';
select assert_eq((select count(*)::int from public.profiles where display_name = 'Hijacked'), 0,
  'a friend cannot edit someone else''s profile');

-- Marking a friend's habit complete fails two different ways, on purpose.
select assert_raises(
  $$insert into public.habit_checkins (habit_id, user_id, completion_date)
    values ('c1111111-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', '2026-08-14')$$,
  'row-level security',
  'a friend cannot check off another person''s habit (policy blocks a forged user_id)');

select assert_raises(
  $$insert into public.habit_checkins (habit_id, user_id, completion_date)
    values ('c1111111-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', '2026-08-14')$$,
  'foreign key',
  'a friend cannot check off another person''s habit (FK blocks their own user_id)');

-- Ura cannot create a habit owned by Monica, nor one in a group she is not in.
select assert_raises(
  $$insert into public.habits (owner_id, group_id, name, recurrence_type, scheduled_days)
    values ('11111111-1111-1111-1111-111111111111', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Sneaky', 'scheduled_days', '{1}')$$,
  'row-level security',
  'a user cannot create a habit owned by someone else');

select assert_raises(
  $$insert into public.habits (owner_id, group_id, name, recurrence_type, scheduled_days)
    values ('22222222-2222-2222-2222-222222222222', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'Sneaky', 'scheduled_days', '{1}')$$,
  'row-level security',
  'a user cannot create a habit in a group they do not belong to');

-- Nobody can grant themselves group membership from the client.
select assert_raises(
  $$insert into public.group_members (group_id, user_id)
    values ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '22222222-2222-2222-2222-222222222222')$$,
  'row-level security|permission denied',
  'a user cannot add themselves to another group');

select assert_raises(
  $$insert into public.groups (name) values ('My New Group')$$,
  'row-level security|permission denied',
  'a user cannot create groups from the client');

-- Ura CAN manage her own things.
update public.habits set name = 'Yoga (evening)' where id = 'c2222222-0000-0000-0000-000000000001';
select assert_eq((select count(*)::int from public.habits where name = 'Yoga (evening)'), 1,
  'a user can rename their own habit');

insert into public.habit_checkins (habit_id, user_id, completion_date)
  values ('c2222222-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', '2026-08-13');
select assert_eq((select count(*)::int from public.habit_checkins
                  where habit_id = 'c2222222-0000-0000-0000-000000000001'), 2,
  'a user can check off their own habit');

delete from public.habit_checkins
  where habit_id = 'c2222222-0000-0000-0000-000000000001' and completion_date = '2026-08-13';
select assert_eq((select count(*)::int from public.habit_checkins
                  where habit_id = 'c2222222-0000-0000-0000-000000000001'), 1,
  'a user can undo their own check-in');

update public.profiles set display_name = 'Ura P.', timezone = 'Europe/London'
  where id = '22222222-2222-2222-2222-222222222222';
select assert_eq((select display_name from public.profiles where id = '22222222-2222-2222-2222-222222222222'),
  'Ura P.', 'a user can edit their own profile');

-- ----------------------------------------------------------------------------
-- Zed — an authenticated stranger in a different group
-- ----------------------------------------------------------------------------

select act_as('99999999-9999-9999-9999-999999999999');

select assert_eq((select count(*)::int from public.habits), 0,
  'an unrelated account sees none of the group''s habits');
select assert_eq((select count(*)::int from public.habit_checkins), 0,
  'an unrelated account sees none of the group''s check-ins');
select assert_eq((select count(*)::int from public.profiles), 1,
  'an unrelated account sees only their own profile');
select assert_eq((select count(*)::int from public.group_members), 1,
  'an unrelated account sees only their own membership');
select assert_eq((select count(*)::int from public.groups), 1,
  'an unrelated account sees only their own group');

-- ----------------------------------------------------------------------------
-- Anonymous — a request with no valid JWT
-- ----------------------------------------------------------------------------

reset role;
set role anon;
select set_config('request.jwt.claims', null, false);

select assert_raises($$select count(*) from public.habits$$,        'permission denied', 'anon cannot read habits');
select assert_raises($$select count(*) from public.profiles$$,      'permission denied', 'anon cannot read profiles');
select assert_raises($$select count(*) from public.habit_checkins$$,'permission denied', 'anon cannot read check-ins');
select assert_raises($$select count(*) from public.groups$$,        'permission denied', 'anon cannot read groups');
select assert_raises($$select count(*) from public.group_members$$, 'permission denied', 'anon cannot read memberships');
select assert_raises($$select public.my_group_ids()$$,              'permission denied', 'anon cannot call the RLS helper');

reset role;
\echo ''
\echo '================================'
\echo ' All RLS assertions passed.'
\echo '================================'
